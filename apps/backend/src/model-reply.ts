import { canonical, validate, type Schemas } from "./domain.js";
import { redact } from "./model.js";

export const UNAVAILABLE_BLOCKS: Schemas["AgentMessage"]["blocks"] = [{
  type: "text",
  text: "Je ne dispose pas d’une source administrative validée pour répondre à cette demande. Veuillez préciser la démarche ou consulter le portail officiel.",
  sources: [],
}];
export const MODEL_UNAVAILABLE_BLOCKS: Schemas["AgentMessage"]["blocks"] = [{
  type: "text",
  text: "La réponse n’a pas pu être produite. Veuillez réessayer ; vérifiez le statut de votre demande avant de relancer une action.",
  sources: [],
}];

/** @deprecated The model may use natural sentences. Administrative facts still need a real source. */
export const SAFE_CONVERSATIONAL_TEXT: string[] = [];

export const FORMAT_REMINDER =
  'Rappel de format : appelle uniquement les outils annoncés avec leur nom exact, ou fournis l’objet JSON {"blocks":[...]} dans le contenu texte assistant, sans appeler d’outil json ou final. Un texte sans fait administratif peut avoir sources: []. Tout tarif, pièce, délai ou lien doit citer une Source déjà observée (procedureId et url du résultat d’outil) ; n’invente aucune URL. Ne répète pas une action dont le résultat est déjà présent.';

const ADMIN_FACT = /(?:FCFA|PS\d{5}|https?:\/\/|\d{2,}|\b(?:tarifs?|pièces|documents?|délais?|lien officiel)\b)/i;

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
  try {
    const blocks = parseOrWrap(replyText).map((block: any) => {
      if (!MODEL_BLOCK_TYPES.has(block?.type))
        reject("unsupported_block", "Le modèle ne produit que du texte, des boutons ou un formulaire.");
      if (block.type === "text") {
        if (typeof block.text !== "string" || !block.text.trim() || !Array.isArray(block.sources))
          reject("invalid_text_block", "Texte modèle invalide.");
        const cited = Array.isArray(block.sources) ? block.sources : [];
        if (draftCitesOutside(block.text, evidence.sources)) reject("unobserved_source", "Source non observée.");
        const sources = cited.length
          ? cited.map((source: unknown) => bindObservedSource(source, evidence.sources))
          : hasAdministrativeFact(block.text)
            ? (evidence.sources.length ? evidence.sources : reject("admin_fact_without_source", "Fait administratif sans source."))
            : [];
        return { ...block, text: redact(block.text), sources };
      }
      return block;
    }) as Schemas["AgentMessage"]["blocks"];
    return validatedBlocks(blocks);
  } catch (error) {
    const reason = error instanceof ModelReplyError ? error.reason : error instanceof SyntaxError ? "invalid_json" : "invalid_reply";
    logRejectedReply(reason, { observedSourceCount: evidence.sources.length });
    throw error;
  }
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
