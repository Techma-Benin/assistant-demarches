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
  RESUME_AFTER_CONSENT,
  RESUME_AFTER_LOGIN,
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
import { presentModelReply, mergeSystemBlocks, PAYMENT_CONFIRM_PREFIX, PREPARE_REQUEST_PREFIX, PAYMENT_LATER_PREFIX, SUBMIT_REQUEST_PREFIX, MODEL_UNAVAILABLE_BLOCKS, UNAVAILABLE_BLOCKS, FORMAT_REMINDER, ModelReplyError, logRejectedReply, hasActionSystemBlocks, isGenericRefusal, honestReplyFromSystemBlocks, bindUploadedFile, fileReceivedInstruction, parseReceivedPiece } from "./model-reply.js";
import { transcriberFromActiveModel, type TranscriptionPort } from "./transcription.js";
import { LiveReply } from "./live-reply.js";
import { visibleText } from "./text-deltas.js";
import { readModelSecret } from "./secrets.js";
import type { Files } from "./files.js";
import { coerceFieldValue, parseFormValues } from "./form-values.js";

const MODEL_REPLY_ATTEMPTS = 3;
const CATALOGUE_LOOKUP = /casier|passeport|carte\s+d['’]?identit|extrait(?:\s+d['’]acte)?|quels?\s+documents|documents?\s+requis|comment\s+faire|je\s+veux\s+(?:demander|faire|obtenir|déposer)|pièces\s+(?:pour|à|demand)/i;
const PROCEDURE_DETAILS = /documents?\s+requis|quels?\s+documents|comment\s+faire|pièces|tarif|délai/i;

export function needsCatalogueLookup(text: string): boolean {
  return CATALOGUE_LOOKUP.test(text);
}

const CASE_LIST_QUESTION = /o[uù]\s+en\s+(?:est|sont)\s+(?:ma|mes|mon)\b|statuts?\s+(?:de|d['’]?)\s*(?:ma|mes|mon|l['’]?)\s*(?:demandes?|dossiers?)|\bmes\s+(?:demandes|dossiers)\b|(?:mon|ma)\s+(?:dossier|demande)\s+en\s+est\s+o[uù]|suivi\s+de\s+(?:ma|mes|mon)\s+(?:demandes?|dossiers?)/i;

/** The user asks where their requests stand: answered from their case list, never from memory. */
export function needsCaseList(text: string): boolean {
  return CASE_LIST_QUESTION.test(text);
}

const PAYMENT_QUESTION = /\bpayer\b|\bje\s+paie\b|\br[ée]gler\b|\bpaiement\b/i;

/** The user says they want to pay: the Backend answers with the confirmation button, never with a payment. */
export function needsPayment(text: string): boolean {
  return PAYMENT_QUESTION.test(text);
}

/** Backend tool without MCP server: lists the signed-in user's cases through X-Road. */
export const CASES_LIST_TOOL: ToolDefinition = {
  name: "cases.list",
  description: "Liste les dossiers de l’usager connecté (référence, intitulé, statut, paiement, dernière mise à jour). À appeler pour savoir où en sont ses demandes, y compris dans une nouvelle conversation.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  _meta: { "bj.techma/kind": "read", "bj.techma/requiresLogin": true },
};
const CASE_CARDS = 3;

export function needsProcedureDetails(text: string): boolean {
  return PROCEDURE_DETAILS.test(text);
}

function catalogueSearchName(tools: ToolDefinition[]): string | undefined {
  return tools.find((tool) => tool.name === "procedures.search" || tool.name.endsWith(".procedures.search"))?.name;
}

function catalogueGetName(tools: ToolDefinition[]): string | undefined {
  return tools.find((tool) => tool.name === "procedures.get" || tool.name.endsWith(".procedures.get"))?.name;
}

function documentsAttachName(tools: ToolDefinition[]): string | undefined {
  return tools.find((tool) => tool.name === "documents.attach" || tool.name.endsWith(".documents.attach"))?.name;
}

function requestCreateName(tools: ToolDefinition[]): string | undefined {
  return tools.find((tool) => tool.name === "request.create" || tool.name.endsWith(".request.create"))?.name;
}

function calledTool(state: State, name: string | undefined): boolean {
  return Boolean(name && state.history.some((turn) => turn.role === "assistant" && turn.calls?.some((call) => call.name === name || call.name.endsWith("." + name))));
}

function requestUpdateName(tools: ToolDefinition[]): string | undefined {
  return tools.find((tool) => tool.name === "request.update" || tool.name.endsWith(".request.update"))?.name;
}

function requestSubmitName(tools: ToolDefinition[]): string | undefined {
  return tools.find((tool) => tool.name === "request.submit" || tool.name.endsWith(".request.submit"))?.name;
}

function requestPayName(tools: ToolDefinition[]): string | undefined {
  return tools.find((tool) => tool.name === "request.pay" || tool.name.endsWith(".request.pay"))?.name;
}

function wantsFiling(text: string): boolean {
  return /je\s+veux\s+(?:demander|faire|obtenir|déposer)|demander\s+mon|déposer\s+(?:un|mon|une)/i.test(text);
}
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
    "reference",
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
const DETAIL_CODES = new Set(["INVALID_REQUEST", "REQUEST_INCOMPLETE", "PAYMENT_CONFIRMATION_REQUIRED"]);
/** What the model may read about a failure: the Tooling detail for correctable errors, a fixed sentence otherwise. */
function toolErrorDetail(result: ToolResult): string {
  if (DETAIL_CODES.has(toolErrorCode(result))) {
    try {
      const detail = JSON.parse(result.content.find((item) => item.type === "text")?.text ?? "{}").detail;
      if (typeof detail === "string" && detail.trim()) return detail.slice(0, 300);
    } catch { /* fall through to the generic sentence */ }
  }
  return "L’outil a échoué.";
}
function formatFcfa(amount: number): string {
  return Math.round(amount).toString().replace(/\B(?=(\d{3})+(?!\d))/g, "\u202f") + "\u00a0FCFA";
}
const PAYMENT_BUTTON_LABEL_MAX = 24;
/** Label of the payment confirmation button: the amount when it fits the contract limit, a generic one otherwise. */
function paymentButtonLabel(amount: unknown): string {
  if (Number.isInteger(amount) && (amount as number) >= 0) {
    const label = "Confirmer " + formatFcfa(amount as number);
    if (label.length <= PAYMENT_BUTTON_LABEL_MAX) return label;
  }
  return "Confirmer le paiement";
}
const BLOCKING_CODES = new Set(["LOGIN_REQUIRED", "MANDATE_MISSING", "MANDATE_EXPIRED"]);
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
  /** Action that waited for a login or a consent: replayed once when the resume message arrives. */
  replay?: { name: string; arguments: string };
  replayDone?: boolean;
  blockedRecorded?: boolean;
  /** Values the user submitted with a form interaction (JSON object). */
  formValues?: Record<string, unknown>;
  /** Latest draft or ready request shown in this conversation. */
  openRequest?: { id: string; procedureId: string; fieldNames: string[] };
  /** Procedure of the latest request shown in this conversation, whatever its status. */
  activeProcedureId?: string;
  /** cases.list ran in this turn: the reply may report what the connector returned. */
  connectorData?: boolean;
  /** requestId the user confirmed paying with the payment button. */
  paymentConfirmed?: string;
  /** Request of this conversation whose latest known case card awaits payment. */
  payableRequest?: string;
  /** cases.list showed a case awaiting payment that belongs to another conversation: the Backend tells where to pay. */
  payElsewhere?: boolean;
  /** procedureId the user chose to prepare with the Backend's prepare button. */
  prepareProcedure?: string;
  /** requestId the user chose to file with the Backend's submit button. */
  submitRequest?: string;
  /** request.submit succeeded in this turn: no submit question is asked again. */
  submitted?: boolean;
  paymentPrompt?: { requestId: string; label: string };
};
export class Agent {
  constructor(
    private pool: Pool,
    private conversations: Conversations,
    private models: ModelPort,
    private tooling: ToolingPort,
    private consent?: Consent,
    private transcriber?: TranscriptionPort,
    private listCases?: (userRef: string) => Promise<unknown>,
    private audioFiles?: Pick<Files, "readOwned">,
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
  private async audioTranscriber(administrationId: string): Promise<TranscriptionPort | undefined> {
    if (this.audioFiles) {
      const selected = await transcriberFromActiveModel(this.pool, administrationId, this.audioFiles);
      if (selected) return selected;
    }
    return this.transcriber;
  }
  private async run(
    conversation: OwnedConversation,
    input: MessageInput,
    traceparent: string,
    administrationId: string,
  ) {
    if (input.content.type === "audio") {
      const transcriber = await this.audioTranscriber(administrationId);
      if (!transcriber) {
        // No MODEL_API_KEY / TRANSCRIPTION_API_KEY_ENV: say so instead of a generic failure.
        await this.finish(conversation, input, [{ type: "text", text: "La transcription des messages vocaux n’est pas disponible pour le moment. Veuillez décrire votre demande par écrit.", sources: [] }], traceparent);
        return;
      }
      try {
        const text = await transcriber.transcribe(input.content.fileId, conversation.userRef);
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
    if (
      input.content.type === "interaction" &&
      input.content.actionId.startsWith(PAYMENT_LATER_PREFIX)
    ) {
      // "Later" pays nothing and needs no model: the request stays awaiting payment.
      await this.finish(
        conversation,
        input,
        [
          {
            type: "text",
            text: "D’accord, rien n’a été payé. Votre dossier reste en attente de paiement. Quand vous serez prêt, écrivez « je veux payer » dans cette conversation.",
            sources: [],
          },
        ],
        traceparent,
      );
      return;
    }
    let formValues: Record<string, unknown> | undefined;
    let confirmedPayment: string | undefined;
    let preparedProcedure: string | undefined;
    let submittedRequest: string | undefined;
    if (input.content.type === "interaction") {
      formValues = parseFormValues(input.content.value);
      if (input.content.actionId.startsWith(PAYMENT_CONFIRM_PREFIX))
        confirmedPayment = input.content.actionId.slice(PAYMENT_CONFIRM_PREFIX.length);
      if (input.content.actionId.startsWith(PREPARE_REQUEST_PREFIX))
        preparedProcedure = input.content.actionId.slice(PREPARE_REQUEST_PREFIX.length);
      if (input.content.actionId.startsWith(SUBMIT_REQUEST_PREFIX))
        submittedRequest = input.content.actionId.slice(SUBMIT_REQUEST_PREFIX.length);
      input = {
        ...input,
        content: { type: "text", text: interactionPrompt(input.content) },
      };
    }
    let mergedNoteId: string | undefined;
    if (input.content.type === "file") {
      // Composer often sends documentType null; bind to the oldest unmet fileRequest when one is pending.
      const bound = await this.bindFileUpload(conversation.id, input.id, input.content.documentType ?? null);
      if (bound) {
        // The Interface posts "a file + a text" as two messages: answer them in one turn, one message.sent.
        const note = await this.attachedNote(conversation.id, input.id, input.sentAt);
        if (note) mergedNoteId = note.id;
        // A form answer sent right after the piece is answered in the same turn.
        if (note?.values) formValues = note.values;
        input = {
          ...input,
          content: {
            type: "text",
            text: fileReceivedInstruction(bound.requestId, bound.documentType, input.content.fileId) + (note?.text ? "\nMessage joint par l’usager : " + redact(note.text) : ""),
          },
        };
        if (note)
          await this.pool.query(
            "UPDATE backend_messages SET processed_at=now() WHERE conversation_id=$1 AND id=$2 AND processed_at IS NULL",
            [conversation.id, note.id],
          );
      }
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
          "SELECT body FROM backend_configurations WHERE administration_id=$1 AND resource='models' AND body->>'active'='true' AND CASE WHEN body->>'role'='transcription' THEN 'transcription' ELSE 'discussion' END='discussion' ORDER BY resource_id",
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
          "SELECT e.body,m.body AS input FROM backend_conversation_events e LEFT JOIN backend_messages m ON m.conversation_id=e.conversation_id AND m.id=e.body->'data'->>'messageId' WHERE e.conversation_id=$1 AND e.expires_at>now() AND (e.body->'data'->>'kind'='message.sent' OR (e.body->'data'->>'kind'='message.received' AND m.id<>ALL($2::text[]))) ORDER BY e.seq DESC LIMIT 20",
          [conversation.id, mergedNoteId ? [input.id, mergedNoteId] : [input.id]],
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
      if (formValues) state.formValues = formValues;
      if (confirmedPayment) state.paymentConfirmed = confirmedPayment;
      // Latest known status per request, from the case cards of this conversation: a newer card cancels an older one.
      const caseStatus = new Map<string, string>();
      for (const row of previous)
        if (row.body.data.kind === "message.sent")
          for (const block of row.body.data.message.blocks as Schemas["AgentMessage"]["blocks"])
            if (block.type === "caseCard" && state.requestProcedures?.[block.case.requestId]) {
              caseStatus.delete(block.case.requestId);
              caseStatus.set(block.case.requestId, block.case.status);
            }
      state.payableRequest = [...caseStatus].reverse().find(([, status]) => status === "awaiting_payment")?.[0];
      if (preparedProcedure) state.prepareProcedure = preparedProcedure;
      if (submittedRequest) state.submitRequest = submittedRequest;
      const cards = new Map<string, NonNullable<State["openRequest"]> & { status: string }>();
      for (const row of previous)
        if (row.body.data.kind === "message.sent")
          for (const block of row.body.data.message.blocks as Schemas["AgentMessage"]["blocks"])
            if (block.type === "requestCard" && block.request.conversationId === conversation.id)
              cards.set(block.request.id, { id: block.request.id, procedureId: block.request.procedureId, fieldNames: block.request.fields.map((field) => field.name), status: block.request.status });
      state.activeProcedureId = [...cards.values()].pop()?.procedureId;
      const open = [...cards.values()].filter((card) => card.status === "draft" || card.status === "ready").pop();
      if (open) state.openRequest = { id: open.id, procedureId: open.procedureId, fieldNames: open.fieldNames };
      const resumed = input.content.text === RESUME_AFTER_CONSENT || input.content.text === RESUME_AFTER_LOGIN;
      if (resumed) {
        const waiting = (await this.pool.query("SELECT pending_action FROM backend_conversations WHERE id=$1", [conversation.id])).rows[0]?.pending_action;
        if (waiting && typeof waiting.name === "string" && typeof waiting.arguments === "string") {
          state.replay = { name: waiting.name, arguments: waiting.arguments };
          if (waiting.formValues && typeof waiting.formValues === "object") state.formValues = waiting.formValues;
        }
      }
      await this.save(conversation.id, input.id, state);
      if (resumed) await this.pool.query("UPDATE backend_conversations SET pending_action=NULL WHERE id=$1", [conversation.id]);
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
    if (this.listCases) advertised.push(CASES_LIST_TOOL);
    // Deltas go out while the model generates; every path below settles them before writing message.sent.
    const live = new LiveReply(this.conversations, conversation.id, state.assistantMessageId, traceparent);
    try {
    while (state.step < 8) {
      if (!state.pending) {
        const { reply, blocks } = await this.generateUsable(state, advertised, live, conversation, administrationId);
        await live.settle();
        if (!reply) {
          if (isGenericRefusal(blocks))
            await this.unanswered(conversation.id, input.id, administrationId, state.toolFailed ? "tool_failure" : state.sources.length > 0 || blocks !== UNAVAILABLE_BLOCKS ? "invalid_reply" : "missing_source");
          this.offerPayElsewhere(state);
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
          if (blocks!.some(block => block.type === "text" && /Je n[’']ai pas trouvé de démarche validée|Je ne peux répondre qu[’']aux questions sur les démarches administratives|Aucune action disponible/.test(block.text))) await this.unanswered(conversation.id, input.id, administrationId, "missing_source");
          else if (state.toolFailed && blocks!.some(block => block.type === "text" && /L[’']outil n[’']a pas pu|Action refusée/.test(block.text))) await this.unanswered(conversation.id, input.id, administrationId, "tool_failure");
          const offered = this.offerForm(state, blocks!);
          this.offerPayment(state);
          this.offerPayElsewhere(state);
          this.offerSubmit(state);
          const sent = this.withSystem(state, this.offerPreparation(state, offered));
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
            // cases.list has no MCP binding: the Backend answers it from X-Road, scoped to the conversation's user.
            if (call.name === CASES_LIST_TOOL.name && this.listCases) {
              if (!conversation.authenticated)
                throw new Problem(401, "LOGIN_REQUIRED", "Connexion requise pour cette action.");
              result = await this.runCasesList(state, conversation.userRef);
            } else {
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
            if (binding.name === "request.update" && typeof argumentsValue.requestId === "string" && Array.isArray(argumentsValue.fields)) {
              // The form schema decides the type of each value (a form sends "2", the schema wants 2).
              const procedureId = state.requestProcedures?.[argumentsValue.requestId] ?? (state.openRequest?.id === argumentsValue.requestId ? state.openRequest.procedureId : undefined);
              let known = procedureId ? state.procedures?.find((item) => item.id === procedureId) : undefined;
              const reader = [...bindings.values()].find((item) => item.name === "procedures.get");
              if (!known && procedureId && reader) {
                try {
                  const read = await this.tooling.call(reader.server.url, reader.server.auth, reader.name, { procedureId }, { ...context, external: reader.server.policy !== "techma" }, operationKey + "-procedure", reader.definition);
                  const loaded = read.isError ? undefined : read.structuredContent as any;
                  if (loaded) {
                    validate("Procedure", loaded);
                    if (loaded.source.procedureId === loaded.id) {
                      state.sources.push(loaded.source);
                      state.procedures ??= [];
                      state.procedures.push(loaded);
                      known = loaded;
                    }
                  }
                } catch { /* Without the procedure the values go through unchanged. */ }
              }
              const properties = (known?.filing?.formSchema as { properties?: Record<string, unknown> } | undefined)?.properties;
              if (properties)
                for (const field of argumentsValue.fields as { name?: unknown; value?: unknown }[])
                  if (field && typeof field.name === "string" && Object.hasOwn(properties, field.name))
                    field.value = coerceFieldValue(field.value, properties[field.name]);
            }
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
            if (binding.name === "request.pay" && typeof argumentsValue.requestId === "string" && state.paymentConfirmed !== argumentsValue.requestId) {
              // The amount is announced first; only the user's own click on the payment button lets request.pay through.
              let label = "Confirmer le paiement";
              let detail = "Le montant n’a pas pu être lu. Invitez l’usager à confirmer le paiement avec le bouton.";
              const statusReader = [...bindings.values()].find((item) => item.name === "case.status");
              if (statusReader) {
                try {
                  const read = await this.tooling.call(statusReader.server.url, statusReader.server.auth, statusReader.name, { requestId: argumentsValue.requestId }, { ...context, external: statusReader.server.policy !== "techma" }, operationKey + "-amount", statusReader.definition);
                  const amount = read.isError ? undefined : (read.structuredContent as any)?.payment?.amountFcfa;
                  if (Number.isInteger(amount) && amount >= 0) {
                    detail = `Montant à payer : ${formatFcfa(amount)}. Annoncez-le à l’usager et invitez-le à confirmer avec le bouton.`;
                    label = paymentButtonLabel(amount);
                  }
                } catch { /* The prompt stays generic when the amount cannot be read. */ }
              }
              state.paymentPrompt = { requestId: argumentsValue.requestId, label };
              throw new Problem(409, "PAYMENT_CONFIRMATION_REQUIRED", detail);
            }
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
        if (selected?.name === "request.submit" && !result.isError) state.submitted = true;
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
          if (BLOCKING_CODES.has(code) && !state.blockedRecorded) {
            state.blockedRecorded = true;
            await this.pool.query("UPDATE backend_conversations SET pending_action=$2 WHERE id=$1", [
              conversation.id,
              { name: call.name, arguments: call.arguments, ...(state.formValues ? { formValues: state.formValues } : {}) },
            ]);
          }
          if (code === "PAYMENT_CONFIRMATION_REQUIRED") {
            let requestId: unknown;
            try { requestId = JSON.parse(call.arguments).requestId; } catch { /* no prompt without a request */ }
            if (typeof requestId === "string")
              this.pushBlock(state, {
                type: "buttons",
                items: [
                  { id: PAYMENT_CONFIRM_PREFIX + requestId, label: state.paymentPrompt?.requestId === requestId ? state.paymentPrompt.label : "Confirmer le paiement" },
                  { id: PAYMENT_LATER_PREFIX + requestId, label: "Plus tard" },
                ],
              });
          }
          if (code === "LOGIN_REQUIRED")
            this.pushBlock(state, {
              type: "loginRequired",
              reason: call.name === CASES_LIST_TOOL.name ? "Connectez-vous pour consulter vos demandes." : "Connectez-vous pour préparer ou déposer cette démarche.",
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
                detail: toolErrorDetail(result),
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
  /** Calls X-Road for the user's cases; shows the latest ones as cards and hands the model a short summary. */
  private async runCasesList(state: State, userRef: string): Promise<ToolResult> {
    const page = (await this.listCases!(userRef)) as { items?: unknown };
    const cases: Schemas["Case"][] = [];
    for (const item of Array.isArray(page?.items) ? page.items : []) {
      try {
        validate("Case", item);
        cases.push(item as Schemas["Case"]);
      } catch { /* Anything that is not a full Case never becomes a card. */ }
    }
    cases.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    state.connectorData = true;
    const latest = cases.slice(0, CASE_CARDS);
    for (const item of latest) this.pushBlock(state, { type: "caseCard", case: item });
    // request.pay is bound to the conversation the request was made in: elsewhere, the user is sent back there.
    const elsewhere = (item: Schemas["Case"]) => item.status === "awaiting_payment" && !state.requestProcedures?.[item.requestId];
    if (latest.some(elsewhere)) state.payElsewhere = true;
    const summary = {
      total: cases.length,
      cases: latest.map((item) => ({
        reference: item.reference,
        title: item.title,
        status: item.status,
        payment: { status: item.payment.status, amountFcfa: item.payment.amountFcfa },
        updatedAt: item.updatedAt,
        ...(elsewhere(item) ? { nextStep: "Le paiement se fait dans la conversation d’origine de cette demande, à rouvrir depuis Mes démarches." } : {}),
      })),
    };
    return { structuredContent: summary, content: [{ type: "text", text: JSON.stringify(summary) }] };
  }
  private withSystem(state: State, blocks: Schemas["AgentMessage"]["blocks"]) {
    return mergeSystemBlocks(blocks, state.systemBlocks ?? []);
  }
  /** A draft with empty fields always comes with its form: the Backend builds it, the model's own forms are dropped. */
  private offerForm(state: State, blocks: Schemas["AgentMessage"]["blocks"]): Schemas["AgentMessage"]["blocks"] {
    const request = state.requests.at(-1);
    if (!request || (request.status !== "draft" && request.status !== "ready")) return blocks;
    if (state.systemBlocks?.some((block) => block.type === "loginRequired" || block.type === "consent")) return blocks;
    const empty = request.fields.filter((field) => field.value === null || field.value === undefined || (typeof field.value === "string" && field.value.trim() === ""));
    if (!empty.length) return blocks;
    const schema = state.procedures?.find((item) => item.id === request.procedureId)?.filing?.formSchema as { properties?: Record<string, { type?: unknown; format?: unknown } | undefined>; required?: unknown } | undefined;
    const required = Array.isArray(schema?.required) ? schema.required : undefined;
    const fieldType = (name: string): "text" | "number" | "date" => {
      const property = schema?.properties?.[name];
      const types = Array.isArray(property?.type) ? property.type : [property?.type];
      if (types.includes("integer") || types.includes("number")) return "number";
      return property?.format === "date" ? "date" : "text";
    };
    this.pushBlock(state, {
      type: "form",
      id: "request.form." + request.id,
      fields: empty.map((field) => ({
        name: field.name.slice(0, 100),
        label: (field.label || field.name).slice(0, 200),
        required: schema ? Boolean(required?.includes(field.name)) : true,
        type: fieldType(field.name),
      })),
    });
    return blocks.filter((block) => block.type !== "form");
  }
  /** A case awaiting payment in this conversation always comes with the question and two buttons; only the confirmation click pays. */
  private offerPayment(state: State) {
    const card = [...(state.systemBlocks ?? [])].reverse().find((block) => block.type === "caseCard" && block.case.status === "awaiting_payment");
    if (card?.type !== "caseCard" || !state.requestProcedures?.[card.case.requestId]) return;
    if (state.systemBlocks?.some((block) => block.type === "buttons" && block.items.some((item) => item.id.startsWith(PAYMENT_CONFIRM_PREFIX)))) return;
    const amount = card.case.payment.amountFcfa;
    this.pushBlock(state, {
      type: "text",
      text: Number.isInteger(amount) && (amount as number) >= 0
        ? `Il reste à payer ${formatFcfa(amount as number)}. Voulez-vous payer maintenant ?`
        : "Il reste des frais à payer. Voulez-vous payer maintenant ?",
      sources: [],
    });
    this.pushBlock(state, {
      type: "buttons",
      items: [
        { id: PAYMENT_CONFIRM_PREFIX + card.case.requestId, label: paymentButtonLabel(amount) },
        { id: PAYMENT_LATER_PREFIX + card.case.requestId, label: "Plus tard" },
      ],
    });
  }
  /** A case awaiting payment in another conversation cannot be paid here: the Backend says where to go, once. */
  private offerPayElsewhere(state: State) {
    if (!state.payElsewhere) return;
    this.pushBlock(state, { type: "text", text: "Pour payer, rouvrez la conversation de cette demande depuis « Mes démarches », puis écrivez « je veux payer ».", sources: [] });
  }
  /** A complete request that was not filed in this turn is never left hanging: the Backend asks, the click files. */
  private offerSubmit(state: State) {
    const request = state.requests.at(-1);
    if (!request || request.status !== "ready" || request.missing.length > 0 || state.submitted) return;
    if (state.systemBlocks?.some((block) => block.type === "loginRequired" || block.type === "consent")) return;
    this.pushBlock(state, { type: "text", text: "Votre dossier est complet. Voulez-vous le déposer ?", sources: [] });
    this.pushBlock(state, { type: "buttons", items: [{ id: SUBMIT_REQUEST_PREFIX + request.id, label: "Déposer mon dossier" }] });
  }
  /** Only the Backend knows whether a procedure can be filed: it offers the prepare button itself. */
  private offerPreparation(state: State, blocks: Schemas["AgentMessage"]["blocks"]): Schemas["AgentMessage"]["blocks"] {
    if (state.requests.length || state.openRequest || state.activeProcedureId) return blocks;
    if (hasActionSystemBlocks(state.systemBlocks)) return blocks;
    if (blocks.some((block) => block.type === "form")) return blocks;
    const cited = new Set(blocks.flatMap((block) => block.type === "text" ? block.sources.map((source) => source.procedureId) : []));
    if (cited.size !== 1) return blocks;
    const [procedureId] = [...cited];
    if (!state.procedures?.some((item) => item.id === procedureId && item.filing)) return blocks;
    this.pushBlock(state, { type: "buttons", items: [{ id: PREPARE_REQUEST_PREFIX + procedureId, label: "Préparer ma demande" }] });
    return blocks.filter((block) => block.type !== "buttons");
  }
  private pushBlock(state: State, block: Schemas["AgentMessage"]["blocks"][number]) {
    state.systemBlocks ??= [];
    // One card per request or case in a message: the latest state replaces the earlier one.
    if (block.type === "requestCard")
      state.systemBlocks = state.systemBlocks.filter((existing) => !(existing.type === "requestCard" && existing.request.id === block.request.id));
    if (block.type === "caseCard")
      state.systemBlocks = state.systemBlocks.filter((existing) => !(existing.type === "caseCard" && existing.case.id === block.case.id));
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
    conversation: OwnedConversation,
    administrationId: string,
  ): Promise<{ reply?: ModelReply; blocks?: Schemas["AgentMessage"]["blocks"] }> {
    if (state.replay && !state.replayDone) {
      // The action that waited for a login or a consent goes through the whole pipeline again, without the model.
      state.replayDone = true;
      return { reply: { text: "", calls: [{ id: identifier("call"), name: state.replay.name, arguments: state.replay.arguments }] } };
    }
    let fallback = MODEL_UNAVAILABLE_BLOCKS;
    const question = [...state.history].reverse().find((turn) => turn.role === "user")?.content ?? "";
    const searchName = catalogueSearchName(tools);
    const getName = catalogueGetName(tools);
    const attachName = documentsAttachName(tools);
    const createName = requestCreateName(tools);
    const needsCatalogue = Boolean(searchName) && needsCatalogueLookup(question) && !state.history.some((turn) => turn.role === "tool");
    const updateName = requestUpdateName(tools);
    if (state.formValues && updateName && !calledTool(state, updateName)) {
      const draft = [...state.requests].reverse().find((item) => item.status === "draft" || item.status === "ready")
        ?? (state.openRequest ? { id: state.openRequest.id, fields: state.openRequest.fieldNames.map((name) => ({ name })) } : undefined);
      if (draft) {
        const known = new Set(draft.fields.map((field) => field.name));
        const fields = Object.entries(state.formValues)
          .filter(([name, value]) => known.has(name) && value !== null && value !== undefined && (typeof value === "number" || typeof value === "boolean" || (typeof value === "string" && value.trim() !== "")))
          .map(([name, value]) => ({ name, value, source: "answer" }));
        if (fields.length)
          return { reply: { text: "", calls: [{ id: identifier("call"), name: updateName, arguments: JSON.stringify({ requestId: draft.id, fields }) }] } };
      }
    }
    const payName = requestPayName(tools);
    if (state.paymentConfirmed && payName && !calledTool(state, payName))
      return { reply: { text: "", calls: [{ id: identifier("call"), name: payName, arguments: JSON.stringify({ requestId: state.paymentConfirmed }) }] } };
    if (state.payableRequest && payName && needsPayment(question) && !calledTool(state, payName))
      return { reply: { text: "", calls: [{ id: identifier("call"), name: payName, arguments: JSON.stringify({ requestId: state.payableRequest }) }] } };
    const submitName = requestSubmitName(tools);
    if (state.submitRequest && submitName && !calledTool(state, submitName))
      return { reply: { text: "", calls: [{ id: identifier("call"), name: submitName, arguments: JSON.stringify({ requestId: state.submitRequest }) }] } };
    if (state.prepareProcedure && createName && !calledTool(state, createName))
      return { reply: { text: "", calls: [{ id: identifier("call"), name: createName, arguments: JSON.stringify({ procedureId: state.prepareProcedure }) }] } };
    // "I want to pay" in a chat with no request of its own: the case list tells whether a payment waits in another conversation.
    const payFromNewChat = needsPayment(question) && !state.payableRequest && !state.requests.length && !state.activeProcedureId;
    if (tools.some((tool) => tool.name === CASES_LIST_TOOL.name) && (needsCaseList(question) || payFromNewChat) && !calledTool(state, CASES_LIST_TOOL.name))
      return { reply: { text: "", calls: [{ id: identifier("call"), name: CASES_LIST_TOOL.name, arguments: "{}" }] } };
    const piece = parseReceivedPiece(question);
    if (piece && attachName && !calledTool(state, attachName)) {
      return {
        reply: {
          text: "",
          calls: [{ id: identifier("call"), name: attachName, arguments: JSON.stringify({ requestId: piece.requestId, documentType: piece.documentType, fileId: piece.fileId }) }],
        },
      };
    }
    // Sources are observed per turn: a reply refused for lack of one reads the fiche of the current request, then is redone.
    const missingFiche = (): ModelReply | undefined => {
      const procedureId = state.requests.at(-1)?.procedureId ?? state.activeProcedureId;
      if (!getName || !procedureId || state.sources.length || calledTool(state, getName)) return undefined;
      return { text: "", calls: [{ id: identifier("call"), name: getName, arguments: JSON.stringify({ procedureId }) }] };
    };
    const forcedSearch = (): ModelReply => ({
      text: "",
      calls: [{ id: identifier("call"), name: searchName!, arguments: JSON.stringify({ query: question.slice(0, 500) || "démarche" }) }],
    });
    const forcedGet = (): ModelReply | undefined => {
      if (!getName || !needsProcedureDetails(question) || !state.procedures?.length || calledTool(state, getName)) return undefined;
      const procedureId = (state.procedures.find((item) => item.filing) ?? state.procedures[0]).id;
      return { text: "", calls: [{ id: identifier("call"), name: getName, arguments: JSON.stringify({ procedureId }) }] };
    };
    const guestCreate = (): Schemas["Procedure"] | undefined => {
      const procedure = state.procedures?.find((item) => item.filing) ?? state.procedures?.[0];
      return !conversation.authenticated
        && createName
        && procedure
        && wantsFiling(question)
        && !state.history.some((turn) => turn.role === "assistant" && turn.calls?.some((call) => call.name === createName))
        ? procedure
        : undefined;
    };
    let requireTool = false;
    for (let attempt = 0; attempt < MODEL_REPLY_ATTEMPTS; attempt++) {
      // No tool is run in this retry loop. Successfully checkpointed tool results
      // stay in the history, including after a worker restart.
      const history: Turn[] = attempt === 0 ? state.history : [
        ...state.history,
        { role: "user", content: FORMAT_REMINDER },
      ];
      // Text that is certain to be dropped for a forced call stays silent from the start.
      const listener = await live.attempt(state.sources, { hold: needsCatalogue || Boolean(forcedGet()) || Boolean(guestCreate()) || Boolean(missingFiche()) });
      // json_schema + tools makes Groq/Gemini skip or reject function calls (400 / prose without tools).
      const structuredOutput = !tools.length;
      let reply: ModelReply;
      try {
        reply = await this.models.generate(state.config, history, tools, {
          onTextDelta: listener.onTextDelta,
          onToolCall: listener.onToolCall,
          structuredOutput,
          apiKey: await readModelSecret(this.pool, administrationId, state.config.id),
          ...(requireTool && searchName ? { toolChoice: "required" } : {}),
        });
      }
      catch (error) {
        listener.reject();
        // Groq rejects malformed/hallucinated tool generations before any local
        // tool executes. Retry only this classified error within the same reply
        // budget; never parse or execute its untrusted failed_generation body.
        if (error instanceof DiagnosticProblem && error.diagnostic.reason === "provider_tool_generation_invalid") continue;
        if (
          needsCatalogue
          && searchName
          && error instanceof DiagnosticProblem
          && error.diagnostic.reason === "provider_request_rejected"
        ) return { reply: forcedSearch() };
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
      const missCatalogue = (): "retry" | ModelReply | undefined => {
        if (!needsCatalogue || !searchName) return undefined;
        // Gemini OpenAI-compat often 400s on tool_choice; force the catalogue tool instead.
        if (requireTool || /generativelanguage\.googleapis\.com/i.test(state.config.baseUrl)) return forcedSearch();
        requireTool = true;
        return "retry";
      };
      if (typeof reply.text !== "string" || !reply.text.trim()) {
        listener.reject();
        const forced = missCatalogue();
        if (forced === "retry") continue;
        if (forced) return { reply: forced };
        logRejectedReply("empty_reply", { attempt });
        continue;
      }
      try {
        const blocks = presentModelReply(reply.text, state);
        const procedure = guestCreate();
        if (procedure && createName) {
          listener.reject();
          return {
            reply: {
              text: "",
              calls: [{ id: identifier("call"), name: createName, arguments: JSON.stringify({ procedureId: procedure.id }) }],
            },
          };
        }
        const forced = missCatalogue();
        if (forced === "retry") {
          listener.reject();
          continue;
        }
        if (forced) {
          listener.reject();
          return { reply: forced };
        }
        const details = forcedGet();
        if (details) {
          listener.reject();
          return { reply: details };
        }
        listener.complete(reply.text);
        live.publishVisible(visibleText(blocks));
        return { reply, blocks };
      }
      catch (error) {
        listener.reject();
        const forced = missCatalogue();
        if (forced === "retry") continue;
        if (forced) return { reply: forced };
        const fiche = error instanceof ModelReplyError && (error.reason === "admin_fact_without_source" || error.reason === "unobserved_source") ? missingFiche() : undefined;
        if (fiche) return { reply: fiche };
        if (!(error instanceof ModelReplyError) || error.reason !== "invalid_json") fallback = UNAVAILABLE_BLOCKS;
      }
    }
    if (needsCatalogue && searchName) return { reply: forcedSearch() };
    const details = forcedGet();
    if (details) return { reply: details };
    const honest = this.honestFallback(state);
    if (honest) fallback = honest;
    live.publishVisible(visibleText(fallback));
    return { blocks: fallback };
  }
  private honestFallback(state: State): Schemas["AgentMessage"]["blocks"] | undefined {
    const system = state.systemBlocks ?? [];
    if (state.connectorData && system.some((block) => block.type === "caseCard"))
      return [{ type: "text", text: "Voici où en sont vos demandes.", sources: [] }];
    const evidence = state.sources.length > 0 || state.requests.length > 0 || state.history.some((turn) => turn.role === "tool");
    if (!hasActionSystemBlocks(system) || !evidence) return undefined;
    return honestReplyFromSystemBlocks(system);
  }
  /**
   * The text or form answer sent right after a file (next message of the conversation, processed or not, so a replay finds it too).
   * Waits up to 1 s for it, as the Interface posts it once the file is accepted; another file ends the wait.
   */
  private async attachedNote(conversationId: string, messageId: string, sentAt: string): Promise<{ id: string; text?: string; values?: Record<string, unknown> } | undefined> {
    const current = (await this.pool.query("SELECT seq FROM backend_messages WHERE conversation_id=$1 AND id=$2", [conversationId, messageId])).rows[0];
    if (!current) return undefined;
    for (let waited = 0; ; waited += 200) {
      const next = (
        await this.pool.query(
          "SELECT id, body FROM backend_messages WHERE conversation_id=$1 AND seq>$2 ORDER BY seq ASC LIMIT 1",
          [conversationId, current.seq],
        )
      ).rows[0];
      if (next) {
        const content = next.body?.content;
        const gap = Math.abs(Date.parse(next.body?.sentAt) - Date.parse(sentAt));
        const text = content?.type === "text" && typeof content.text === "string" ? content.text : "";
        // A form answer (interaction carrying a JSON object) merges as well; a bare button click keeps its own turn.
        const values = content?.type === "interaction" ? parseFormValues(content.value) : undefined;
        if (!(gap < 5000)) return undefined;
        if (values) return { id: next.id, values };
        if (!text.trim() || text === RESUME_AFTER_CONSENT || text === RESUME_AFTER_LOGIN) return undefined;
        return { id: next.id, text };
      }
      if (waited >= 1000) return undefined;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  private async bindFileUpload(conversationId: string, messageId: string, documentType: string | null) {
    const requests = (
      await this.pool.query(
        `SELECT e.seq, b->>'requestId' AS request_id, b->>'documentType' AS document_type, COALESCE((b->>'received')::boolean, false) AS received
           FROM backend_conversation_events e, jsonb_array_elements(e.body->'data'->'message'->'blocks') b
          WHERE e.conversation_id=$1 AND e.body->'data'->>'kind'='message.sent' AND b->>'type'='fileRequest'
          ORDER BY e.seq ASC`,
        [conversationId],
      )
    ).rows;
    const latest = new Map<string, { requestId: string; received: boolean; seq: number }>();
    for (const row of requests) latest.set(row.document_type, { requestId: row.request_id, received: row.received, seq: Number(row.seq) });
    const pending = [...latest.entries()]
      .filter(([, item]) => !item.received)
      .sort((left, right) => left[1].seq - right[1].seq)
      .map(([type, item]) => ({ requestId: item.requestId, documentType: type }));
    const previous = (
      await this.pool.query(
        `SELECT id, body->'content'->>'documentType' AS document_type
           FROM backend_messages
          WHERE conversation_id=$1 AND id<>$2 AND body->'content'->>'type'='file'
          ORDER BY body->>'sentAt' ASC, id ASC`,
        [conversationId, messageId],
      )
    ).rows.map((row) => ({ documentType: row.document_type ?? null }));
    return bindUploadedFile(pending, previous, { documentType });
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
