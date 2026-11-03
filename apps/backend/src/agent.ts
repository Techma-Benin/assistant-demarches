import { modelToolName, type McpServer } from "./mcp-connections.js";
import { DiagnosticProblem, describeError, logFailure } from "./diagnostics.js";
import type { Pool } from "pg";
import {
  canonical,
  validate,
  Problem,
  identifier,
  type Schemas,
  type ModelConfig,
} from "./domain.js";
import {
  Conversations,
  appendEvent,
  envelope,
  type OwnedConversation,
  type MessageInput,
} from "./conversations.js";
import { transaction } from "./transactions.js";
import {
  catalog,
  compileMcpSchema,
  sameMcpDefinition,
  type ToolingPort,
  type ToolDefinition,
  type ToolResult,
} from "./tooling.js";
import { redact, type ModelPort, type ModelReply, type Turn } from "./model.js";
import type { Consent } from "./consent.js";
import { presentModelReply, mergeSystemBlocks, MODEL_UNAVAILABLE_BLOCKS, UNAVAILABLE_BLOCKS, FORMAT_REMINDER, ModelReplyError, logRejectedReply } from "./model-reply.js";
import type { TranscriptionPort } from "./transcription.js";
import { LiveReply } from "./live-reply.js";
import { visibleText } from "./text-deltas.js";

const MODEL_REPLY_ATTEMPTS = 3;
function interactionPrompt(content: { actionId: string; value?: string | null }): string {
  const submitted = content.value?.trim();
  return submitted
    ? `Formulaire « ${content.actionId} » : ${submitted}`
    : `Choix « ${content.actionId} ».`;
}
function modelData(value: unknown): string {
  const privateFields = new Set([
    "userRef",
    "applicantRef",
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
    privateFields.has(key) || (typeof item === "string" && /^(usr|cnv)_/.test(item))
      ? undefined
      : typeof item === "string" && !technicalFields.has(key)
        ? redact(item)
        : item,
  );
}
function filingMandateScopes(definition?: ToolDefinition): Schemas["Scope"][] {
  const collected = new Set<string>();
  for (const tool of catalog) {
    const scopes = tool._meta?.["bj.techma/scopes"];
    if (!Array.isArray(scopes)) continue;
    for (const scope of scopes) if (typeof scope === "string") collected.add(scope);
  }
  const extra = definition?._meta?.["bj.techma/scopes"];
  if (Array.isArray(extra)) for (const scope of extra) if (typeof scope === "string") collected.add(scope);
  return [...collected] as Schemas["Scope"][];
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
  requestProcedures?: Record<string, string>;
  procedures?: Schemas["Procedure"][];
  successfulActions?: { fingerprint: string; operationKey: string }[];
  toolFailed?: boolean;
  systemBlocks?: Schemas["AgentMessage"]["blocks"];
  config: ModelConfig;
  assistantMessageId?: string;
};
export class Agent {
  constructor(
    private pool: Pool,
    private conversations: Conversations,
    private models: ModelPort,
    private tooling: ToolingPort,
    private consent?: Consent,
    private transcriber?: TranscriptionPort,
  ) {}
  watch(signal: AbortSignal): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let running: Promise<void> = Promise.resolve();
    return new Promise((resolve) => {
      const finish = async () => {
        if (timer) clearTimeout(timer);
        await running.catch(() => undefined);
        resolve();
      };
      if (signal.aborted) {
        void finish();
        return;
      }
      signal.addEventListener("abort", () => void finish(), { once: true });
      const tick = async () => {
        if (signal.aborted) return;
        try {
          const rows = (
            await this.pool.query(
              "SELECT DISTINCT conversation_id FROM backend_messages WHERE processed_at IS NULL LIMIT 5",
            )
          ).rows;
          for (const row of rows) {
            if (signal.aborted) return;
            await this.process(row.conversation_id).catch((error: unknown) => {
              if (!(error instanceof Problem) || error.status !== 503) throw error;
            });
          }
        } catch (error) {
          if (signal.aborted) return;
          console.error(error instanceof Error ? error.message : "Traitement des messages interrompu.");
        }
        if (!signal.aborted)
          timer = setTimeout(() => {
            running = tick();
          }, 400);
      };
      running = tick();
    });
  }
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
            "SELECT m.*,(c.body || jsonb_build_object('userRef', c.user_ref)) AS conversation,c.administration_id FROM backend_messages m JOIN backend_conversations c ON c.id=m.conversation_id WHERE m.conversation_id=$1 AND m.processed_at IS NULL ORDER BY m.seq LIMIT 1",
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
          await this.unanswered(row.conversation.id, row.body.id, row.administration_id, "provider_failure");
          const checkpoint = (
            await this.pool.query(
              "SELECT state->>'assistantMessageId' AS id FROM backend_agent_checkpoints WHERE conversation_id=$1 AND message_id=$2",
              [conversationId, row.body.id],
            )
          ).rows[0];
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
            checkpoint?.id ?? undefined,
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
    conversation: OwnedConversation,
    input: MessageInput,
    traceparent: string,
    administrationId: string,
  ) {
    if (input.content.type === "audio") {
      if (!this.transcriber) {
        // No MODEL_API_KEY / TRANSCRIPTION_API_KEY_ENV: say so instead of a generic failure.
        await this.finish(conversation, input, [{ type: "text", text: "La transcription des messages vocaux n’est pas disponible pour le moment. Veuillez décrire votre demande par écrit.", sources: [] }], traceparent);
        return;
      }
      try {
        const text = await this.transcriber.transcribe(input.content.fileId, conversation.userRef);
        if (text && text.trim().length > 4000) {
          await this.finish(conversation, input, [{ type: "text", text: "Le message vocal est trop long. Veuillez envoyer un audio plus court ou préciser votre demande par écrit.", sources: [] }], traceparent);
          return;
        }
        if (text?.trim()) {
          await this.conversations.recordTranscript(
            conversation.id,
            input.id,
            text.trim(),
            traceparent,
          );
          input = { ...input, content: { type: "text", text: text.trim() } };
        }
        else {
          await this.finish(conversation, input, [{ type: "text", text: "L’audio n’a pas pu être transcrit. Veuillez préciser votre demande par écrit.", sources: [] }], traceparent);
          return;
        }
      } catch {
        await this.finish(conversation, input, [{ type: "text", text: "L’audio n’a pas pu être transcrit. Veuillez préciser votre demande par écrit.", sources: [] }], traceparent);
        return;
      }
    }
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
            channel: conversation.channel,
            authenticated: true,
            expiresAt: Date.now() + 60000,
            roles: new Set<string>(),
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
    if (input.content.type === "interaction") {
      input = {
        ...input,
        content: { type: "text", text: interactionPrompt(input.content) },
      };
    }
    if (input.content.type === "file" && input.content.documentType) {
      // Answer to a `fileRequest` block: the model only sees opaque references, never the document itself.
      const pending = (
        await this.pool.query(
          `SELECT b->>'requestId' AS request_id
             FROM backend_conversation_events e, jsonb_array_elements(e.body->'data'->'message'->'blocks') b
            WHERE e.conversation_id=$1 AND e.body->'data'->>'kind'='message.sent'
              AND b->>'type'='fileRequest' AND b->>'documentType'=$2
            ORDER BY e.seq DESC LIMIT 1`,
          [conversation.id, input.content.documentType],
        )
      ).rows[0];
      if (pending?.request_id)
        input = {
          ...input,
          content: {
            type: "text",
            text: `Pièce reçue pour la demande ${pending.request_id} : type de pièce « ${input.content.documentType} », fichier ${input.content.fileId}. Rattache-la au brouillon avec l’outil de rattachement de pièces (requestId, documentType, fileId ci-dessus).`,
          },
        };
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
            row.input?.content?.type === "text" ||
            row.input?.content?.type === "interaction",
        )
        .map((row) =>
          row.body.data.kind === "message.sent"
            ? {
                role: "assistant",
                content: modelData(row.body.data.message.blocks),
              }
            : {
                role: "user",
                content: redact(
                  row.input.content.type === "interaction"
                    ? interactionPrompt(row.input.content)
                    : row.input.content.text,
                ),
              },
        );
      state = {
        history: [
          ...history,
          { role: "user", content: redact(input.content.text) },
        ],
        step: 0,
        sources: [],
        requests: [],
        requestProcedures: Object.fromEntries(previous.flatMap(row => row.body.data.kind === "message.sent" ? (row.body.data.message.blocks as Schemas["AgentMessage"]["blocks"]).flatMap(block => block.type === "requestCard" && block.request.conversationId === conversation.id ? [[block.request.id, block.request.procedureId]] : []) : [])),
        procedures: [],
        systemBlocks: [],
        config: configs[0].body,
      };
      await this.save(conversation.id, input.id, state);
    }
    if (!state.assistantMessageId) {
      state.assistantMessageId = identifier("msg");
      await this.save(conversation.id, input.id, state);
    }
    const context = {conversationId:conversation.id,userRef:conversation.userRef,traceparent,channel:conversation.channel,authenticated:conversation.authenticated};
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
        const known=server.policy==="techma"?catalog.find(t=>t.name===remote.name):undefined;
        // Techma tools are the published catalogue; generic MCP still requires an unchanged discovered schema.
        if(server.policy!=="techma"&&permission.definition&&!sameMcpDefinition(permission.definition,remote))continue;
        const definition=known??remote;
        const name=modelToolName(server,remote.name);
        if(bindings.has(name))throw new Problem(503,"UPSTREAM_UNAVAILABLE","Collision des noms MCP ; utiliser des connexions génériques distinctes.");
        bindings.set(name,{server,name:remote.name,definition,requires:Boolean(permission.requires_mandate||known?._meta?.["bj.techma/requiresMandate"])});
        advertised.push({...definition,name});
      }
    }
    // Deltas go out while the model generates; every path below settles them before writing message.sent.
    const live = new LiveReply(this.conversations, conversation.id, state.assistantMessageId, traceparent);
    try {
    while (state.step < 8) {
      if (!state.pending) {
        const { reply, blocks } = await this.generateUsable(state, advertised, live);
        await live.settle();
        if (!reply) {
          await this.unanswered(conversation.id, input.id, administrationId, state.toolFailed ? "tool_failure" : blocks === UNAVAILABLE_BLOCKS ? "missing_source" : "invalid_reply");
          await this.finish(conversation, input, this.withSystem(state, blocks!), traceparent, false, state.assistantMessageId);
          return;
        }
        state.history.push({
          role: "assistant",
          content: reply.text,
          calls: reply.calls,
          ...(reply.rawOutput ? { rawOutput: reply.rawOutput } : {}),
        });
        if (!reply.calls.length) {
          if (blocks!.some(block => block.type === "text" && /Je n[’']ai pas trouvé de démarche validée|Aucune action disponible/.test(block.text))) await this.unanswered(conversation.id, input.id, administrationId, "missing_source");
          else if (state.toolFailed && blocks!.some(block => block.type === "text" && /L[’']outil n[’']a pas pu|Action refusée/.test(block.text))) await this.unanswered(conversation.id, input.id, administrationId, "tool_failure");
          const sent = this.withSystem(state, blocks!);
          await this.finish(conversation, input, sent, traceparent, false, state.assistantMessageId);
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
            if(!current||!current.body.enabled||!current.enabled||canonical(current.body)!==canonical(binding.server))throw new Problem(403,"FORBIDDEN","Connexion ou action désactivée ou modifiée.");
            // Techma listed tools inline $defs; the published catalogue is the frozen contract.
            if(binding.server.policy!=="techma"&&current.definition&&!sameMcpDefinition(current.definition,binding.definition))throw new Problem(403,"FORBIDDEN","Connexion ou action désactivée ou modifiée.");
            const requires = binding.requires || current.requires_mandate;
            const requiresLogin = Boolean(binding.definition._meta?.["bj.techma/requiresLogin"]);
            let argumentsValue: Record<string,unknown>;
            try {argumentsValue=JSON.parse(call.arguments);} catch {throw new Problem(400,"INVALID_REQUEST","Arguments outil JSON invalides.");}
            if(!compileMcpSchema(binding.definition.inputSchema)(argumentsValue))throw new Problem(400,"INVALID_REQUEST","Arguments outil invalides.");
            if (requiresLogin && !conversation.authenticated)
              throw new Problem(401, "LOGIN_REQUIRED", "Connexion requise pour cette action.");
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
            const targetProcedure = typeof argumentsValue.procedureId === "string" ? argumentsValue.procedureId : typeof argumentsValue.requestId === "string" ? state.requestProcedures?.[argumentsValue.requestId] : undefined;
            const scopes = binding.definition._meta?.["bj.techma/scopes"];
            const requiredScopes = Array.isArray(scopes) && scopes.every(scope => typeof scope === "string") ? scopes : [];
            const mandate = requires
              ? (
                  await this.pool.query(
                    "SELECT body FROM backend_mandates WHERE conversation_id=$1 AND user_ref=$2 AND body->>'status'='active' AND (body->>'expiresAt')::timestamptz>now() AND (body->'scopes') @> $3::jsonb AND ($4::text IS NULL OR body->>'procedureId'=$4) ORDER BY id LIMIT 1",
                    [conversation.id, conversation.userRef, JSON.stringify(requiredScopes), targetProcedure ?? null],
                  )
                ).rows[0]?.body
              : undefined;
            if (requires && !mandate)
              throw new Problem(
                403,
                "MANDATE_MISSING",
                "Autorisation explicite requise.",
              );
            const fingerprint = canonical({ name: call.name, arguments: argumentsValue });
            const isWrite = binding.definition._meta?.["bj.techma/kind"] !== "read";
            const previousAction = isWrite ? state.successfulActions?.find(action => action.fingerprint === fingerprint) : undefined;
            const previousResult = previousAction ? (await this.pool.query("SELECT result FROM backend_tool_results WHERE conversation_id=$1 AND operation_key=$2", [conversation.id, previousAction.operationKey])).rows[0]?.result : undefined;
            result = previousResult ?? await this.tooling.call(
              binding.server.url,
              binding.server.auth,
              binding.name,
              argumentsValue,
              {
                ...context,
                channel: conversation.channel,
                authenticated: conversation.authenticated,
                external:binding.server.policy!=="techma",
                ...(mandate ? { mandateId: mandate.id } : {}),
              },
              operationKey,
              binding.definition,
            );
            if (isWrite && !result.isError && !previousAction) {
              state.successfulActions ??= [];
              state.successfulActions.push({ fingerprint, operationKey });
            }
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
        if (selected && selected.definition._meta?.["bj.techma/kind"] !== "read" && !result.isError) {
          try {
            const fingerprint = canonical({ name: call.name, arguments: JSON.parse(call.arguments) });
            state.successfulActions ??= [];
            if (!state.successfulActions.some(action => action.fingerprint === fingerprint)) state.successfulActions.push({ fingerprint, operationKey });
          } catch { /* Invalid arguments have already produced a failed tool result. */ }
        }
        if (result.isError) {
          state.toolFailed = true;
          const code = toolErrorCode(result);
          if (code === "LOGIN_REQUIRED")
            this.pushBlock(state, {
              type: "loginRequired",
              reason: "Connectez-vous pour préparer ou déposer cette démarche.",
            });
          else if (code === "MANDATE_MISSING" || code === "MANDATE_EXPIRED")
            await this.appendConsent(state, conversation, selected, call.arguments, operationKey, traceparent);
        }
        const isTechma=selected?.server.policy==="techma"&&catalog.some(t=>t.name===selected.name);
        const output = (isTechma&&!result.isError?result.structuredContent:undefined) as any;
        for (const procedure of output?.items ??
          (output?.source || output?.filing !== undefined ? [output] : []))
          if (procedure?.filing || procedure?.source) {
            try {
              validate("Procedure", procedure);
              if (procedure.source.procedureId !== procedure.id) continue;
              state.sources.push(procedure.source);
              state.procedures ??= [];
              state.procedures.push(procedure);
            } catch {}
          }
        this.captureToolOutcome(state, conversation.id, selected?.name, output);
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
      this.withSystem(state, [
        {
          type: "text",
          text: "La limite de traitement est atteinte. Veuillez préciser votre demande ; aucune réussite supplémentaire n’est présumée.",
          sources: [],
        },
      ]),
      traceparent,
      false,
      state.assistantMessageId,
    );
    } finally {
      await live.close();
    }
  }
  private withSystem(state: State, blocks: Schemas["AgentMessage"]["blocks"]) {
    return mergeSystemBlocks(blocks, state.systemBlocks ?? []);
  }
  private pushBlock(state: State, block: Schemas["AgentMessage"]["blocks"][number]) {
    state.systemBlocks ??= [];
    if (!state.systemBlocks.some((existing) => existing.type === block.type && JSON.stringify(existing) === JSON.stringify(block)))
      state.systemBlocks.push(block);
  }
  private async appendConsent(
    state: State,
    conversation: OwnedConversation,
    selected: { name: string; definition: ToolDefinition } | undefined,
    rawArguments: string,
    key: string,
    _traceparent: string,
  ) {
    if (!this.consent) return;
    let args: Record<string, unknown> = {};
    try { args = JSON.parse(rawArguments); } catch { return; }
    const procedureId =
      typeof args.procedureId === "string"
        ? args.procedureId
        : typeof args.requestId === "string"
          ? state.requestProcedures?.[args.requestId]
          : undefined;
    const requiredScopes = filingMandateScopes(selected?.definition);
    if (!procedureId || !requiredScopes.length) return;
    try {
      const challenge = await this.consent.challenge(
        {
          userRef: conversation.userRef,
          channel: conversation.channel,
          authenticated: conversation.authenticated,
          expiresAt: Date.now() + 60000,
          roles: new Set<string>(),
        },
        conversation.id,
        { procedureId, scopes: requiredScopes },
        key,
      );
      this.pushBlock(state, { type: "consent", challenge });
    } catch {
      /* A failed challenge still leaves the tool error for the model to explain. */
    }
  }
  private captureToolOutcome(state: State, conversationId: string, toolName: string | undefined, output: any) {
    if (!output || typeof output !== "object") return;
    const request = output.request && typeof output.request === "object" ? output.request : output.status && output.conversationId === conversationId ? output : undefined;
    if (request) {
      try {
        validate("Request", request);
        state.requests = [...state.requests.filter((item) => item.id !== request.id), request];
        state.requestProcedures ??= {};
        state.requestProcedures[request.id] = request.procedureId;
        this.pushBlock(state, { type: "requestCard", request });
        const procedure = state.procedures?.find((item) => item.id === request.procedureId);
        for (const document of request.documents ?? []) {
          if (document.fileId) continue;
          const spec = procedure?.filing?.requiredDocuments?.find((item: { documentType: string }) => item.documentType === document.documentType);
          this.pushBlock(state, {
            type: "fileRequest",
            requestId: request.id,
            documentType: document.documentType,
            label: document.label ?? spec?.label ?? document.documentType,
            acceptedMimeTypes: spec?.acceptedMimeTypes ?? ["application/pdf", "image/jpeg", "image/png"],
            received: false,
          });
        }
      } catch {}
    }
    const foundCase = output.case && typeof output.case === "object" ? output.case : output.reference && output.simulated === true ? output : undefined;
    if (foundCase) {
      try {
        validate("Case", foundCase);
        this.pushBlock(state, { type: "caseCard", case: foundCase });
      } catch {}
    }
  }
  private async unanswered(conversationId: string, messageId: string, administrationId: string, reason: "missing_source" | "tool_failure" | "provider_failure" | "invalid_reply") {
    await this.pool.query(
      "INSERT INTO backend_unanswered(id,conversation_id,message_id,administration_id,reason) VALUES($1,$2,$3,$4,$5) ON CONFLICT(conversation_id,message_id,reason) DO NOTHING",
      [identifier("unq"), conversationId, messageId, administrationId, reason],
    );
  }
  private async generateUsable(
    state: State,
    tools: ToolDefinition[],
    live: LiveReply,
  ): Promise<{ reply?: ModelReply; blocks?: Schemas["AgentMessage"]["blocks"] }> {
    let fallback = MODEL_UNAVAILABLE_BLOCKS;
    for (let attempt = 0; attempt < MODEL_REPLY_ATTEMPTS; attempt++) {
      // No tool is run in this retry loop. Successfully checkpointed tool results
      // stay in the history, including after a worker restart.
      const history: Turn[] = attempt === 0 ? state.history : [
        ...state.history,
        { role: "user", content: FORMAT_REMINDER },
      ];
      const listener = await live.attempt(state.sources);
      const structuredOutput = !tools.length || history.some((turn) => turn.role === "tool");
      let reply: ModelReply;
      try {
        reply = await this.models.generate(state.config, history, tools, {
          onTextDelta: listener.onTextDelta,
          onToolCall: listener.onToolCall,
          structuredOutput,
        });
      }
      catch (error) {
        listener.reject();
        // Groq rejects malformed/hallucinated tool generations before any local
        // tool executes. Retry only this classified error within the same reply
        // budget; never parse or execute its untrusted failed_generation body.
        if (error instanceof DiagnosticProblem && error.diagnostic.reason === "provider_tool_generation_invalid") continue;
        throw error;
      }
      if (!Array.isArray(reply.calls)) {
        listener.reject();
        logRejectedReply("invalid_calls", { attempt });
        continue;
      }
      if (reply.calls.length) {
        listener.reject();
        if (reply.calls.length <= 8 && new Set(reply.calls.map(call => call.id)).size === reply.calls.length && reply.calls.every(call => typeof call.id === "string" && call.id.length > 0 && typeof call.name === "string" && call.name.length > 0 && typeof call.arguments === "string")) return { reply };
        logRejectedReply("invalid_calls", { attempt, callCount: reply.calls.length });
        continue;
      }
      if (typeof reply.text !== "string" || !reply.text.trim()) {
        listener.reject();
        logRejectedReply("empty_reply", { attempt });
        continue;
      }
      try {
        const blocks = presentModelReply(reply.text, state);
        listener.complete(reply.text);
        live.publishVisible(visibleText(blocks));
        return { reply, blocks };
      }
      catch (error) {
        listener.reject();
        if (!(error instanceof ModelReplyError) || error.reason !== "invalid_json") fallback = UNAVAILABLE_BLOCKS;
      }
    }
    return { blocks: fallback };
  }
  private save(cid: string, messageId: string, state: State) {
    return this.pool.query(
      "INSERT INTO backend_agent_checkpoints(conversation_id,message_id,state) VALUES($1,$2,$3) ON CONFLICT(conversation_id,message_id) DO UPDATE SET state=excluded.state",
      [cid, messageId, state],
    );
  }
  private async finish(
    conversation: OwnedConversation,
    input: MessageInput,
    blocks: Schemas["AgentMessage"]["blocks"],
    traceparent: string,
    preserveError = false,
    messageId?: string,
  ) {
    const sent = await transaction(this.pool, async (db) => {
      const event = await this.conversations.complete(
        db,
        conversation.id,
        input.id,
        blocks,
        traceparent,
        preserveError,
        messageId,
      );
      await db.query(
        "DELETE FROM backend_agent_checkpoints WHERE conversation_id=$1 AND message_id=$2",
        [conversation.id, input.id],
      );
      return event;
    });
    this.conversations.emitLive(conversation.id, sent);
  }
}
