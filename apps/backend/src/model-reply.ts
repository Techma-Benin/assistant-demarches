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

/** Throws on malformed output or fabricated evidence so the caller can retry safely. */
export function presentModelReply(replyText: string, evidence: ReplyEvidence): Schemas["AgentMessage"]["blocks"] {
  const blocks = parseModelBlocks(replyText).map((block: any) => {
    if (!MODEL_BLOCK_TYPES.has(block?.type))
      throw new Error("Le modèle ne produit que du texte, des boutons ou un formulaire.");
    if (block.type === "text") {
      if (typeof block.text !== "string" || !block.text.trim() || !Array.isArray(block.sources)) throw new Error("Texte modèle invalide.");
      if (block.sources.some((source: unknown) => !evidence.sources.some((known) => canonical(known) === canonical(source)))) throw new Error("Source non observée.");
      if (!block.sources.length && /(?:FCFA|PS\d{5}|https?:\/\/|\d{2,})/i.test(block.text) && !SAFE_CONVERSATIONAL_TEXT.includes(block.text))
        throw new Error("Fait administratif sans source.");
      return { ...block, text: redact(block.text) };
    }
    return block;
  }) as Schemas["AgentMessage"]["blocks"];
  return validatedBlocks(blocks);
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
