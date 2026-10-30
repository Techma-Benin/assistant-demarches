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

// A model-supplied label such as “clarification” is not a provenance check.
// Keep unsourced conversational text bounded to reviewed, non-administrative copy.
export const SAFE_CONVERSATIONAL_TEXT = [
  "Bonjour ! Quelle démarche souhaitez-vous effectuer ?",
  "Quelle démarche souhaitez-vous effectuer ?",
  "Pouvez-vous préciser la démarche et l’administration concernées ?",
  "Pouvez-vous préciser votre demande ?",
  "Je peux vous aider à rechercher une démarche et à suivre votre dossier.",
  "Je n’ai pas trouvé de démarche validée correspondant à votre demande. Pouvez-vous préciser votre recherche ?",
  "Une autorisation explicite via l’interface est nécessaire pour poursuivre cette action.",
  "L’outil n’a pas pu effectuer cette action. Veuillez vérifier le statut de votre demande avant de réessayer.",
  "Aucune action disponible.",
  "Action refusée.",
];
const normalize = (text: string) => text.normalize("NFC").replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim();
const safeText = new Set(SAFE_CONVERSATIONAL_TEXT.map(normalize));

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

/** Throws on malformed output or fabricated evidence so the caller can retry safely. */
export function presentModelReply(replyText: string, evidence: ReplyEvidence): Schemas["AgentMessage"]["blocks"] {
  const blocks = parseModelBlocks(replyText).map((block: any) => {
    if (block?.type === "statusCard") {
      const request = evidence.requests.find((item) => item.id === block.request?.id);
      if (!request) throw new Error("Statut sans preuve d’outil.");
      // Only the opaque id is accepted from the model; its own status is ignored.
      return { type: "statusCard", request };
    }
    if (block?.type === "text") {
      if (typeof block.text !== "string" || !block.text.trim() || !Array.isArray(block.sources)) throw new Error("Texte modèle invalide.");
      if (block.sources.some((source: unknown) => !evidence.sources.some((known) => canonical(known) === canonical(source)))) throw new Error("Source non observée.");
      if (block.sources.length === 0 && !safeText.has(normalize(block.text))) throw new Error("Texte sans provenance administrative.");
      return { ...block, text: redact(block.text) };
    }
    // A required document or a form is also an administrative assertion.
    if (block?.type === "fileRequest") {
      if (!evidence.procedures?.some((procedure) => procedure.requiredDocuments.includes(block.documentType))) throw new Error("Pièce non issue du catalogue validé.");
    } else if (block?.type === "form") {
      if (!evidence.procedures?.some((procedure) => {
        const properties = procedure.formSchema.properties as Record<string, unknown> | undefined;
        return properties && Array.isArray(block.fields) && block.fields.every((field: any) => typeof field.name === "string" && Object.hasOwn(properties, field.name));
      })) throw new Error("Formulaire non issu du catalogue validé.");
    } else if (block?.type === "buttons") {
      if (evidence.sources.length === 0 && evidence.requests.length === 0) throw new Error("Actions sans contexte validé.");
    }
    return block;
  }) as Schemas["AgentMessage"]["blocks"];
  validate("AgentMessage", {
    id: "msg_00000000000000000000000001",
    conversationId: "cnv_00000000000000000000000001",
    createdAt: new Date().toISOString(),
    blocks,
  });
  return blocks;
}
