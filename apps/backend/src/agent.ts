import { modelToolName, type McpServer } from "./mcp-connections.js";
import { describeError, logFailure } from "./diagnostics.js";
import type { Pool } from "pg";
import {
  canonical,
  validate,
  Problem,
  type Schemas,
  type ToolConfig,
  type ModelConfig,
} from "./domain.js";
import {
  Conversations,
  appendEvent,
  envelope,
  type Conversation,
  type MessageInput,
} from "./conversations.js";
import { transaction } from "./transactions.js";
import {
  catalog,
  compileMcpSchema,
  type ToolingPort,
  type ToolDefinition,
  type ToolResult,
} from "./tooling.js";
import { redact, type ModelPort, type Turn } from "./model.js";
import type { Consent } from "./consent.js";

const unavailable =
  "Je ne dispose pas d’une source administrative validée pour répondre à cette demande. Veuillez consulter le portail officiel.";
function modelData(value: unknown): string {
  const privateFields = new Set([
    "userRef",
    "conversationId",
    "proofToken",
    "evidenceRef",
    "mandateId",
    "traceId",
  ]);
  const technicalFields = new Set([
    "id",
    "requestId",
    "procedureId",
    "fileId",
    "url",
    "officialLink",
    "version",
    "retrievedAt",
    "createdAt",
    "updatedAt",
    "expiresAt",
  ]);
  return JSON.stringify(value, (key, item) =>
    privateFields.has(key)
      ? undefined
      : typeof item === "string" && !technicalFields.has(key)
        ? redact(item)
        : item,
  );
}
function toolErrorCode(result: ToolResult): string {
  try {
    const code = JSON.parse(
      result.content.find((item) => item.type === "text")?.text ?? "{}",
    ).code;
    return typeof code === "string" && /^[A-Z_]{1,64}$/.test(code)
      ? code
      : "TOOL_ERROR";
  } catch {
    return "TOOL_ERROR";
  }
}
type State = {
  history: Turn[];
  step: number;
  pending?: {
    calls: { id: string; name: string; arguments: string }[];
    next: number;
  };
  sources: Schemas["Source"][];
  requests: Schemas["Request"][];
  config: ModelConfig;
  externalResults?: boolean;
};
export class Agent {
  constructor(
    private pool: Pool,
    private conversations: Conversations,
    private models: ModelPort,
    private tooling: ToolingPort,
    private consent?: Consent,
  ) {}
  async process(conversationId: string): Promise<void> {
    // Session lock survives checkpoint transactions, but is released on connection loss/crash.
    const lock = await this.pool.connect();
    const acquired = (
      await lock.query(
        "SELECT pg_try_advisory_lock(hashtextextended($1,1)) AS acquired",
        [conversationId],
      )
    ).rows[0].acquired;
    if (!acquired) {
      lock.release();
      throw new Problem(
        503,
        "UPSTREAM_UNAVAILABLE",
        "Conversation déjà en traitement.",
      );
    }
    try {
      for (let count = 0; count < 50; count++) {
        const row = (
          await this.pool.query(
            "SELECT m.*,c.body AS conversation,c.administration_id FROM backend_messages m JOIN backend_conversations c ON c.id=m.conversation_id WHERE m.conversation_id=$1 AND m.processed_at IS NULL ORDER BY m.seq LIMIT 1",
            [conversationId],
          )
        ).rows[0];
        if (!row) return;
        if (
          row.attempts >= 12 ||
          Date.now() - row.created_at.getTime() >= 86400000
        ) {
          logFailure("agent.processing_exhausted", new Problem(503, "PROCESSING_EXHAUSTED", "Traitement abandonné après la limite de tentatives ou de durée."), {
            conversationId, messageId: row.id, attempts: row.attempts,
            traceId: row.traceparent?.split("-")[1], lastError: row.last_error ?? "unknown",
          });
          await this.finish(
            row.conversation,
            row.body,
            [
              {
                type: "text",
                text: "Le traitement n’a pas pu être terminé. Vérifiez le statut de votre demande avant de relancer une action.",
                sources: [],
              },
            ],
            row.traceparent,
            true,
          );
          continue;
        }
        try {
          await this.run(
            row.conversation,
            row.body,
            row.traceparent,
            row.administration_id,
          );
        } catch (error) {
          const diagnostic = {
            ...describeError(error), timestamp: new Date().toISOString(),
            conversationId, messageId: row.id, attempt: row.attempts + 1,
            traceId: row.traceparent?.split("-")[1],
          };
          logFailure("agent.processing_failed", error, diagnostic);
          await this.pool.query(
            "UPDATE backend_messages SET attempts=attempts+1,last_error=$3 WHERE conversation_id=$1 AND id=$2",
            [
              conversationId,
              row.id,
              JSON.stringify(diagnostic),
            ],
          );
          throw error;
        }
      }
    } finally {
      await lock.query("SELECT pg_advisory_unlock(hashtextextended($1,1))", [
        conversationId,
      ]);
      lock.release();
    }
  }
  private async run(
    conversation: Conversation,
    input: MessageInput,
    traceparent: string,
    administrationId: string,
  ) {
    if (
      input.content.type === "text" &&
      input.content.text.trim().toUpperCase() === "STOP"
    ) {
      const mandates = (
        await this.pool.query(
          "SELECT id FROM backend_mandates WHERE conversation_id=$1 AND user_ref=$2 AND body->>'status'='active'",
          [conversation.id, conversation.userRef],
        )
      ).rows;
      if (mandates.length && !this.consent)
        throw new Problem(
          503,
          "UPSTREAM_UNAVAILABLE",
          "Révocation indisponible ; nouvelles actions suspendues.",
        );
      for (const mandate of mandates)
        await this.consent!.revoke(
          {
            userRef: conversation.userRef,
            administrationId,
            channel:
              conversation.channel === "whatsapp" ? "whatsapp" : "portal",
            expiresAt: Date.now() + 60000,
          },
          conversation.id,
          mandate.id,
          "stop-" + input.id + "-" + mandate.id,
          traceparent,
        );
      await this.finish(
        conversation,
        input,
        [
          {
            type: "text",
            text: "Les autorisations actives de cette conversation sont révoquées. Les nouvelles actions sont suspendues.",
            sources: [],
          },
        ],
        traceparent,
      );
      return;
    }
    if (
      input.content.type === "text" &&
      input.content.text.trim().toUpperCase() === "HISTORIQUE"
    ) {
      const actions = (
        await this.pool.query(
          "SELECT body->'data' AS action FROM backend_conversation_events WHERE conversation_id=$1 AND body->'data'->>'kind'='tool.called' ORDER BY seq DESC LIMIT 20",
          [conversation.id],
        )
      ).rows;
      const text = actions.length
        ? "Actions de cette conversation : " +
          actions
            .map((row) => row.action.toolName + " (" + row.action.outcome + ")")
            .join(", ")
        : "Aucune action enregistrée pour cette conversation.";
      await this.finish(
        conversation,
        input,
        [{ type: "text", text, sources: [] }],
        traceparent,
      );
      return;
    }
    if (
      input.content.type === "interaction" &&
      input.content.actionId === "mandate.accept"
    ) {
      await this.finish(
        conversation,
        input,
        [
          {
            type: "text",
            text: "Veuillez confirmer l’autorisation avec le bouton et le texte de consentement présentés par l’interface.",
            sources: [],
          },
        ],
        traceparent,
      );
      return;
    }
    if (input.content.type !== "text") {
      await this.finish(
        conversation,
        input,
        [
          {
            type: "text",
            text: "La référence a été reçue. Veuillez décrire votre demande par écrit ; le contenu brut des pièces n’est pas envoyé au modèle.",
            sources: [],
          },
        ],
        traceparent,
      );
      return;
    }
    const saved = (
      await this.pool.query(
        "SELECT state FROM backend_agent_checkpoints WHERE conversation_id=$1 AND message_id=$2",
        [conversation.id, input.id],
      )
    ).rows[0];
    let state: State;
    if (saved) state = saved.state;
    else {
      const configs = (
        await this.pool.query(
          "SELECT body FROM backend_configurations WHERE administration_id=$1 AND resource='models' AND body->>'active'='true' ORDER BY resource_id",
          [administrationId],
        )
      ).rows;
      if (configs.length !== 1)
        throw new Problem(
          503,
          "UPSTREAM_UNAVAILABLE",
          "Un unique modèle actif est requis pour cette administration.",
        );
      const previous = (
        await this.pool.query(
          "SELECT e.body,m.body AS input FROM backend_conversation_events e LEFT JOIN backend_messages m ON m.conversation_id=e.conversation_id AND m.id=e.body->'data'->>'messageId' WHERE e.conversation_id=$1 AND e.expires_at>now() AND (e.body->'data'->>'kind'='message.sent' OR (e.body->'data'->>'kind'='message.received' AND m.id<>$2)) ORDER BY e.seq DESC LIMIT 20",
          [conversation.id, input.id],
        )
      ).rows.reverse();
      const history: Turn[] = previous
        .filter(
          (row) =>
            row.body.data.kind === "message.sent" ||
            row.input?.content?.type === "text",
        )
        .map((row) =>
          row.body.data.kind === "message.sent"
            ? {
                role: "assistant",
                content: modelData(row.body.data.message.blocks),
              }
            : { role: "user", content: redact(row.input.content.text) },
        );
      state = {
        history: [
          ...history,
          { role: "user", content: redact(input.content.text) },
        ],
        step: 0,
        sources: [],
        requests: [],
        config: configs[0].body,
      };
      await this.save(conversation.id, input.id, state);
    }
    const context = {conversationId:conversation.id,userRef:conversation.userRef,traceparent};
    type Binding={server:McpServer;name:string;definition:ToolDefinition;requires:boolean};
    const bindings=new Map<string,Binding>();
    const servers=(await this.pool.query("SELECT body FROM backend_mcp_servers WHERE administration_id=$1 AND body->>'enabled'='true' ORDER BY id",[administrationId])).rows.map(r=>r.body as McpServer);
    const advertised:ToolDefinition[]=[];
    for(const server of servers){
      const permissions=(await this.pool.query("SELECT name,enabled,requires_mandate,definition FROM backend_mcp_tools WHERE administration_id=$1 AND server_id=$2",[administrationId,server.id])).rows;
      const listed=await this.tooling.discover(server.url,server.auth,{...context,external:server.policy!=="techma"});
      for(const permission of permissions){
        if(!permission.enabled)continue;
        const remote=listed.find(t=>t.name===permission.name);if(!remote)continue;
        // A changed remote contract requires explicit admin rediscovery/approval.
        if(permission.definition&&canonical(permission.definition)!==canonical(remote))continue;
        const known=server.policy==="techma"?catalog.find(t=>t.name===remote.name):undefined;
        const definition=known??remote;
        const name=modelToolName(server,remote.name);
        if(bindings.has(name))throw new Problem(503,"UPSTREAM_UNAVAILABLE","Collision des noms MCP ; utiliser des connexions génériques distinctes.");
        bindings.set(name,{server,name:remote.name,definition,requires:Boolean(permission.requires_mandate||known?._meta?.["bj.techma/requiresMandate"])});
        advertised.push({...definition,name});
      }
    }
    while (state.step < 8) {
      if (!state.pending) {
        const reply = await this.models.generate(
          state.config,
          state.history,
          advertised,
        );
        state.history.push({
          role: "assistant",
          content: reply.text,
          calls: reply.calls,
          ...(reply.rawOutput ? { rawOutput: reply.rawOutput } : {}),
        });
        if (!reply.calls.length) {
          let blocks: Schemas["AgentMessage"]["blocks"];
          try {
            blocks = JSON.parse(reply.text).blocks;
            if (Array.isArray(blocks))
              blocks = blocks.map((block) =>
                block.type === "statusCard"
                  ? {
                      type: "statusCard",
                      request:
                        state.requests.find(
                          (request) => request.id === block.request?.id,
                        ) ?? block.request,
                    }
                  : block,
              );
            validate("AgentMessage", {
              id: input.id,
              conversationId: conversation.id,
              createdAt: new Date().toISOString(),
              blocks,
            });
          } catch {
            blocks = [{ type: "text", text: unavailable, sources: [] }];
          }
          // Only citations observed in validated Tooling results can leave the service.
          const provenance = blocks.every((block) =>
            block.type === "text"
              ? (block.sources.length > 0 || state.externalResults === true) &&
                block.sources.every((source) =>
                  state.sources.some(
                    (known) => canonical(known) === canonical(source),
                  ),
                )
              : block.type === "statusCard"
                ? state.requests.some(
                    (request) =>
                      canonical(request) === canonical(block.request),
                  )
                : true,
          );
          if (!provenance)
            blocks = [{ type: "text", text: unavailable, sources: [] }];
          await this.finish(conversation, input, blocks, traceparent);
          return;
        }
        if (
          reply.calls.length > 8 ||
          reply.calls.some(
            (call) =>
              typeof call.id !== "string" ||
              typeof call.name !== "string" ||
              typeof call.arguments !== "string",
          )
        )
          throw new Problem(
            503,
            "UPSTREAM_UNAVAILABLE",
            "Appels modèle invalides.",
          );
        state.pending = { calls: reply.calls, next: 0 };
        await this.save(conversation.id, input.id, state);
      }
      while (state.pending.next < state.pending.calls.length) {
        const index = state.pending.next,
          call = state.pending.calls[index],
          operationKey =
            conversation.id + "-" + input.id + "-" + state.step + "-" + index;
        const cached = (
          await this.pool.query(
            "SELECT result FROM backend_tool_results WHERE conversation_id=$1 AND operation_key=$2",
            [conversation.id, operationKey],
          )
        ).rows[0];
        let result: ToolResult;
        if (cached) result = cached.result;
        else {
          try {
            const binding=bindings.get(call.name);
            if (!binding)
              throw new Problem(403, "FORBIDDEN", "Outil non activé.");
            const current=(await this.pool.query("SELECT s.body,t.enabled,t.requires_mandate,t.definition FROM backend_mcp_servers s JOIN backend_mcp_tools t ON t.administration_id=s.administration_id AND t.server_id=s.id WHERE s.administration_id=$1 AND s.id=$2 AND t.name=$3",[administrationId,binding.server.id,binding.name])).rows[0];
            if(!current||!current.body.enabled||!current.enabled||canonical(current.body)!==canonical(binding.server)||(current.definition&&canonical(current.definition)!==canonical(binding.server.policy==="techma"?catalog.find(t=>t.name===binding.name)??binding.definition:binding.definition)))throw new Problem(403,"FORBIDDEN","Connexion ou action désactivée ou modifiée.");
            const requires = binding.requires || current.requires_mandate;
            let argumentsValue: Record<string,unknown>;
            try {argumentsValue=JSON.parse(call.arguments);} catch {throw new Problem(400,"INVALID_REQUEST","Arguments outil JSON invalides.");}
            if(!compileMcpSchema(binding.definition.inputSchema)(argumentsValue))throw new Problem(400,"INVALID_REQUEST","Arguments outil invalides.");
            if (
              requires &&
              (
                await this.pool.query(
                  "SELECT actions_paused FROM backend_conversations WHERE id=$1",
                  [conversation.id],
                )
              ).rows[0].actions_paused
            )
              throw new Problem(
                403,
                "MANDATE_REVOKED",
                "Nouvelles actions suspendues.",
              );
            const mandate = requires
              ? (
                  await this.pool.query(
                    "SELECT body FROM backend_mandates WHERE conversation_id=$1 AND user_ref=$2 AND body->>'status'='active' AND (body->>'expiresAt')::timestamptz>now() ORDER BY id LIMIT 1",
                    [conversation.id, conversation.userRef],
                  )
                ).rows[0]?.body
              : undefined;
            if (requires && !mandate)
              throw new Problem(
                403,
                "MANDATE_MISSING",
                "Autorisation explicite requise.",
              );
            result = await this.tooling.call(
              binding.server.url,
              binding.server.auth,
              binding.name,
              argumentsValue,
              { ...context, external:binding.server.policy!=="techma", ...(mandate ? { mandateId: mandate.id } : {}) },
              operationKey,
              binding.definition,
            );
          } catch (error) {
            if (!(error instanceof Problem) || error.status >= 500) throw error;
            result = {
              isError: true,
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    code: error.code,
                    detail: error.message,
                    traceId: traceparent.split("-")[1],
                  }),
                },
              ],
            };
          }
          // A crash before this commit reuses the same remote idempotency key.
          await transaction(this.pool, async (db) => {
            await db.query(
              "INSERT INTO backend_tool_results(conversation_id,operation_key,tool_name,result) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",
              [conversation.id, operationKey, call.name, result],
            );
            await appendEvent(
              db,
              conversation.id,
              envelope(
                {
                  kind: "tool.called",
                  toolName: call.name,
                  conversationId: conversation.id,
                  outcome: result.isError ? "error" : "success",
                  code: result.isError ? toolErrorCode(result) : "OK",
                },
                traceparent,
              ),
            );
          });
        }
        const selected=bindings.get(call.name);
        const isTechma=selected?.server.policy==="techma"&&catalog.some(t=>t.name===selected.name);
        if(!isTechma&&!result.isError)state.externalResults=true;
        const output = (isTechma?result.structuredContent:undefined) as any;
        for (const procedure of output?.items ??
          (output?.source ? [output] : []))
          if (procedure.validationStatus === "validated") {
            try {
              validate("Source", procedure.source);
              state.sources.push(procedure.source);
            } catch {}
          }
        if (output?.status && output?.conversationId === conversation.id) {
          try {
            validate("Request", output);
            state.requests.push(output);
          } catch {}
        }
        const sanitized = modelData(
          result.isError
            ? {
                isError: true,
                code: toolErrorCode(result),
                detail: "L’outil a échoué.",
              }
            : { isError: false, result: result.structuredContent ?? result.content.filter(c=>c.type==="text").map(c=>c.text).join("\n") },
        );
        state.history.push({
          role: "tool",
          callId: call.id,
          content: sanitized,
        });
        state.pending.next = index + 1;
        await this.save(conversation.id, input.id, state);
      }
      state.pending = undefined;
      state.step++;
      await this.save(conversation.id, input.id, state);
    }
    await this.finish(
      conversation,
      input,
      [
        {
          type: "text",
          text: "La limite de traitement est atteinte. Veuillez préciser votre demande ; aucune réussite supplémentaire n’est présumée.",
          sources: [],
        },
      ],
      traceparent,
    );
  }
  private save(cid: string, messageId: string, state: State) {
    return this.pool.query(
      "INSERT INTO backend_agent_checkpoints(conversation_id,message_id,state) VALUES($1,$2,$3) ON CONFLICT(conversation_id,message_id) DO UPDATE SET state=excluded.state",
      [cid, messageId, state],
    );
  }
  private async finish(
    conversation: Conversation,
    input: MessageInput,
    blocks: Schemas["AgentMessage"]["blocks"],
    traceparent: string,
    preserveError = false,
  ) {
    await transaction(this.pool, async (db) => {
      await this.conversations.complete(
        db,
        conversation.id,
        input.id,
        blocks,
        traceparent,
        preserveError,
      );
      await db.query(
        "DELETE FROM backend_agent_checkpoints WHERE conversation_id=$1 AND message_id=$2",
        [conversation.id, input.id],
      );
    });
  }
}
