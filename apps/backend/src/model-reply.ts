import { canonical, validate, type Schemas } from "./domain.js";
import { redact } from "./model.js";

export const UNAVAILABLE_TEXT = "Je ne dispose pas d’une source administrative validée pour répondre à cette demande. Veuillez préciser la démarche ou consulter le portail officiel.";
export const MODEL_UNAVAILABLE_TEXT = "La réponse n’a pas pu être produite. Veuillez réessayer ; vérifiez le statut de votre demande avant de relancer une action.";
export const UNAVAILABLE_BLOCKS: Schemas["AgentMessage"]["blocks"] = [{
  type: "text",
  text: UNAVAILABLE_TEXT,
  sources: [],
}];
export const MODEL_UNAVAILABLE_BLOCKS: Schemas["AgentMessage"]["blocks"] = [{
    type: "text",
    text: MODEL_UNAVAILABLE_TEXT,
    sources: [],
}];

/** @deprecated The model may use natural sentences. Administrative facts still need a real source. */
export const SAFE_CONVERSATIONAL_TEXT: string[] = [];

export const FORMAT_REMINDER =
  'Rappel de format : appelle uniquement les outils annoncés avec leur nom exact, ou fournis l’objet JSON {"blocks":[...]} dans le contenu texte assistant, sans appeler d’outil json ou final. Un texte sans fait administratif peut avoir sources: []. Tout tarif, pièce, délai ou lien doit citer une Source déjà observée (procedureId et url du résultat d’outil) ; n’invente aucune URL. Ne répète pas une action dont le résultat est déjà présent.';

const ADMIN_FACT = /(?:F\s?CFA|XOF|PS\d{5}|https?:\/\/|\b\d[\d\s.,]*\s*(?:francs?|jours?|semaines?|mois|heures?)\b|\b(?:pièces?|documents?)\s+(?:requis(?:es)?|à\s+fournir|nécessaires?|exigée?s?)\s+(?:sont|:)|\bdélais?\s+(?:est|sont|:))/i;

export class ModelReplyError extends Error {
  constructor(message: string, readonly reason: string) {
    super(message);
    this.name = "ModelReplyError";
  }
}

export function hasAdministrativeFact(text: string): boolean {
  return ADMIN_FACT.test(text) && !SAFE_CONVERSATIONAL_TEXT.includes(text);
}

export function hasStreamingAdminFact(text: string): boolean {
  return ADMIN_FACT.test(text);
}

/** True when the model is producing the JSON envelope (not free prose). */
export function looksLikeJsonEnvelope(text: string): boolean {
  const payload = text.trim().replace(/^```(?:json)?\s*/i, "");
  return payload.startsWith("{") || payload.startsWith("[");
}

export function logRejectedReply(reason: string, context: Record<string, string | number | boolean | undefined> = {}) {
  console.error(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: "warn",
    event: "model.reply_rejected",
    reason,
    ...Object.fromEntries(Object.entries(context).filter(([, value]) => value !== undefined)),
  }));
}

function logReplyUrlRemoved(count: number) {
  console.error(JSON.stringify({ timestamp: new Date().toISOString(), level: "info", event: "model.reply_url_removed", count }));
}

function reject(reason: string, message: string): never {
  throw new ModelReplyError(message, reason);
}

function normalizeUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    parsed.pathname = parsed.pathname.replace(/\/+$/, "") || "/";
    return parsed.origin.toLowerCase() + parsed.pathname + parsed.search;
  } catch {
    return undefined;
  }
}

export function sourceIdentity(source: { procedureId?: unknown; url?: unknown }): string | undefined {
  if (typeof source.procedureId !== "string" || typeof source.url !== "string") return undefined;
  const url = normalizeUrl(source.url);
  return url ? source.procedureId + "\n" + url : undefined;
}

/** Observed Source of this turn whose procedureId+url match; metadata always comes from the Backend. */
export function bindObservedSource(cited: unknown, observed: Schemas["Source"][]): Schemas["Source"] {
  if (!cited || typeof cited !== "object") reject("unobserved_source", "Source non observée.");
  const identity = sourceIdentity(cited as { procedureId?: unknown; url?: unknown });
  if (!identity) reject("unobserved_source", "Source non observée.");
  const known = observed.find((item) => sourceIdentity(item) === identity);
  if (!known) reject("unobserved_source", "Source non observée.");
  return known;
}

export function draftCitesOutside(raw: string, observed: readonly Pick<Schemas["Source"], "procedureId" | "url">[]): boolean {
  const knownIds = new Set(observed.map((item) => item.procedureId));
  const knownUrls = new Set(observed.map((item) => normalizeUrl(item.url)).filter((item): item is string => Boolean(item)));
  for (const match of raw.matchAll(/https?:\/\/[^\s"'\\<>]+/gi)) {
    const url = normalizeUrl(match[0].replace(/[),.\]]+$/, ""));
    if (!url || !knownUrls.has(url)) return true;
  }
  for (const match of raw.matchAll(/\bPS\d{5}\b/g))
    if (!knownIds.has(match[0])) return true;
  return false;
}

const URL_IN_TEXT = /https?:\/\/[^\s"'\\<>]+/gi;
const MARKDOWN_LINK = /\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/gi;

function removeForeignUrls(text: string, observed: readonly Pick<Schemas["Source"], "url">[]): { text: string; removed: number } {
  const known = new Set(observed.map((item) => normalizeUrl(item.url)).filter((item): item is string => Boolean(item)));
  const foreign = (raw: string) => {
    const url = normalizeUrl(raw.replace(/[),.\]]+$/, ""));
    return !url || !known.has(url);
  };
  let removed = 0;
  let out = text.replace(MARKDOWN_LINK, (whole, label: string, url: string) => {
    if (!foreign(url)) return whole;
    removed++;
    return label;
  });
  out = out.replace(URL_IN_TEXT, (match) => {
    if (!foreign(match)) return match;
    removed++;
    return match.match(/[),.\]]+$/)?.[0] ?? "";
  });
  if (!removed) return { text, removed };
  return { text: out.replace(/\(\s*\)/g, "").replace(/[ \t]{2,}/g, " ").trim(), removed };
}

/** Removes the URLs that are not an observed Source (a Markdown link keeps its label); observed URLs stay intact. */
export function stripForeignUrls(text: string, observed: readonly Pick<Schemas["Source"], "url">[]): string {
  return removeForeignUrls(text, observed).text;
}

/** Accept JSON envelopes and common fenced wrappers, never arbitrary prose. */
export function parseModelBlocks(text: string): unknown[] {
  const payload = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const value = JSON.parse(payload);
  const blocks = Array.isArray(value) ? value : value?.blocks;
  if (!Array.isArray(blocks) || blocks.length === 0) throw new SyntaxError("Réponse modèle vide ou hors contrat JSON.");
  return blocks;
}

export type ReplyEvidence = {
  sources: Schemas["Source"][];
  requests: Schemas["Request"][];
  procedures?: Schemas["Procedure"][];
};

export const PAYMENT_CONFIRM_PREFIX = "payment.confirm.";
const MODEL_BUTTON_LABEL_MAX = 24;
const BACKEND_BLOCK_TYPES = new Set(["fileRequest", "loginRequired", "consent", "requestCard", "caseCard"]);
const MODEL_BLOCK_TYPES = new Set(["text", "buttons", "form"]);

function parseOrWrap(replyText: string): unknown[] {
  const trimmed = replyText.trim();
  if (!trimmed) reject("empty_reply", "Réponse modèle vide ou hors contrat JSON.");
  if (!looksLikeJsonEnvelope(trimmed)) {
    return [{ type: "text", text: trimmed, sources: [] }];
  }
  try {
    return parseModelBlocks(replyText);
  } catch (error) {
    if (error instanceof SyntaxError) reject("invalid_json", error.message);
    throw error;
  }
}

/** Throws on malformed output or fabricated evidence so the caller can retry safely. */
export function presentModelReply(replyText: string, evidence: ReplyEvidence): Schemas["AgentMessage"]["blocks"] {
  let removedUrls = 0;
  try {
    const parsed = parseOrWrap(replyText);
    // The history shows the model the Backend's own cards, and it may copy them: they are dropped, never trusted.
    const authored = parsed.filter((block: any) => !BACKEND_BLOCK_TYPES.has(block?.type));
    if (!authored.length) reject("unsupported_block", "Le modèle ne produit que du texte, des boutons ou un formulaire.");
    const blocks = authored.map((block: any) => {
      if (!MODEL_BLOCK_TYPES.has(block?.type))
        reject("unsupported_block", "Le modèle ne produit que du texte, des boutons ou un formulaire.");
      if (block.type === "text") {
        if (typeof block.text !== "string" || !block.text.trim() || (block.sources != null && !Array.isArray(block.sources)))
          reject("invalid_text_block", "Texte modèle invalide.");
        const cited = Array.isArray(block.sources) ? block.sources : [];
        const cleaned = removeForeignUrls(block.text, evidence.sources);
        removedUrls += cleaned.removed;
        if (!cleaned.text.trim()) reject("empty_reply", "Réponse modèle vide après retrait des liens.");
        if (draftCitesOutside(cleaned.text, evidence.sources)) reject("unobserved_source", "Source non observée.");
        const sources = cited.length
          ? cited.map((source: unknown) => bindObservedSource(source, evidence.sources))
          : hasAdministrativeFact(cleaned.text)
            ? (evidence.sources.length ? evidence.sources : reject("admin_fact_without_source", "Fait administratif sans source."))
            : [];
        return { ...block, text: redact(cleaned.text), sources };
      }
      // Payment confirmation buttons are built by the Backend only: a model copy could pay behind any label.
      // A label over the contract limit loses the button, not the whole reply.
      if (block.type === "buttons" && Array.isArray(block.items))
        return { ...block, items: block.items.filter((item: { id?: unknown; label?: unknown }) => !(typeof item?.id === "string" && item.id.startsWith(PAYMENT_CONFIRM_PREFIX)) && !(typeof item?.label === "string" && item.label.length > MODEL_BUTTON_LABEL_MAX)) };
      return block;
    }).filter((block: any) => block.type !== "buttons" || !Array.isArray(block.items) || block.items.length > 0) as Schemas["AgentMessage"]["blocks"];
    if (!blocks.length) reject("empty_reply", "Réponse modèle vide après retrait des actions réservées.");
    if (removedUrls) logReplyUrlRemoved(removedUrls);
    return validatedBlocks(blocks);
  } catch (error) {
    if (removedUrls) logReplyUrlRemoved(removedUrls);
    const reason = error instanceof ModelReplyError ? error.reason : error instanceof SyntaxError ? "invalid_json" : "invalid_reply";
    logRejectedReply(reason, { observedSourceCount: evidence.sources.length });
    throw error;
  }
}

const ACTION_SYSTEM_TYPES = new Set(["requestCard", "fileRequest", "consent", "loginRequired", "caseCard", "buttons"]);

export function hasActionSystemBlocks(blocks: Schemas["AgentMessage"]["blocks"] = []): boolean {
  return blocks.some((block) => ACTION_SYSTEM_TYPES.has(block.type));
}

export function isGenericRefusal(blocks: Schemas["AgentMessage"]["blocks"] | undefined): boolean {
  const block = blocks?.length === 1 ? blocks[0] : undefined;
  return block?.type === "text" && (block.text === UNAVAILABLE_TEXT || block.text === MODEL_UNAVAILABLE_TEXT);
}

/** Short conversational copy when the model reply is rejected but the Backend already has actionable blocks. */
export function honestReplyFromSystemBlocks(systemBlocks: Schemas["AgentMessage"]["blocks"] = []): Schemas["AgentMessage"]["blocks"] {
  const kinds = new Set(systemBlocks.map((block) => block.type));
  let text = "Voici la suite de votre démarche.";
  if (kinds.has("loginRequired")) text = "Une connexion est nécessaire pour continuer.";
  else if (kinds.has("consent")) text = "Une autorisation est requise pour continuer. Confirmez avec le bouton présenté par l’interface.";
  else if (kinds.has("fileRequest")) text = "Votre dossier est prêt à recevoir les pièces demandées. Ajoutez-les via le bouton prévu.";
  else if (systemBlocks.some((block) => block.type === "buttons" && block.items.some((item) => item.id.startsWith(PAYMENT_CONFIRM_PREFIX))))
    text = "Confirmez le paiement avec le bouton ci-dessous.";
  else if (systemBlocks.some((block) => block.type === "requestCard" && block.request.status === "draft" && block.request.missing.length > 0))
    text = "Votre dossier est en préparation. Il reste des éléments à compléter.";
  else if (kinds.has("caseCard")) text = "Le statut de votre dossier a été mis à jour.";
  else if (kinds.has("requestCard")) text = "Votre dossier a été préparé. Vérifiez la carte ci-dessous.";
  return [{ type: "text", text, sources: [] }];
}

export type PendingFileRequirement = { requestId: string; documentType: string };

/** Oldest unmet fileRequest still open after previous uploads (explicit documentType first, then composer nulls). */
export function bindUploadedFile(
  pending: PendingFileRequirement[],
  previousFiles: { documentType: string | null }[],
  current: { documentType: string | null },
): PendingFileRequirement | undefined {
  const remaining = [...pending];
  for (const file of previousFiles) {
    if (file.documentType) {
      const index = remaining.findIndex((item) => item.documentType === file.documentType);
      if (index >= 0) remaining.splice(index, 1);
    } else if (remaining.length) remaining.shift();
  }
  if (current.documentType) return remaining.find((item) => item.documentType === current.documentType);
  return remaining[0];
}

export function fileReceivedInstruction(requestId: string, documentType: string, fileId: string): string {
  return `Pièce reçue pour la demande ${requestId} : type de pièce « ${documentType} », fichier ${fileId}. Rattache-la au brouillon avec l’outil de rattachement de pièces (requestId, documentType, fileId ci-dessus). Si toutes les pièces exigées sont présentes, dépose le dossier avec l’outil de dépôt.`;
}

export function parseReceivedPiece(text: string): { requestId: string; documentType: string; fileId: string } | undefined {
  const match = text.match(/Pièce reçue pour la demande (req_[0-9A-HJKMNP-TV-Z]{26}) : type de pièce « ([a-z][a-z0-9-]{1,62}) », fichier (fil_[0-9A-HJKMNP-TV-Z]{26})\./);
  return match ? { requestId: match[1], documentType: match[2], fileId: match[3] } : undefined;
}

/** Appends Backend-built blocks (loginRequired, consent, requestCard, fileRequest, caseCard) after the model reply. */
export function mergeSystemBlocks(
  modelBlocks: Schemas["AgentMessage"]["blocks"],
  systemBlocks: Schemas["AgentMessage"]["blocks"] = [],
): Schemas["AgentMessage"]["blocks"] {
  const merged = [...modelBlocks];
  const seen = new Set(modelBlocks.map((block) => canonical(block)));
  for (const block of systemBlocks) {
    const key = canonical(block);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(block);
  }
  return validatedBlocks(merged);
}

function validatedBlocks(blocks: Schemas["AgentMessage"]["blocks"]): Schemas["AgentMessage"]["blocks"] {
  validate("AgentMessage", {
    id: "msg_00000000000000000000000001",
    conversationId: "cnv_00000000000000000000000001",
    createdAt: new Date().toISOString(),
    blocks,
  });
  return blocks;
}
