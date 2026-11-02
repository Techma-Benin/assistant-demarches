import type { Schemas } from '@techma/contracts-ts';
import { contentTypeFor } from './files';

type Content = Schemas['Content'];

export function buttonInteraction(item: { id: string; label: string }): Content {
  return { type: 'interaction', actionId: item.id, value: null };
}

/**
 * Le contrat v2 ne définit pas l'encodage des réponses de formulaire : `Content.interaction` n'a que
 * `actionId` et `value` (chaîne). Choix : `actionId` = `form.id`, `value` = JSON des valeurs. À confirmer avec
 * le Backend ; décision isolée dans ce fichier.
 */
export function formInteraction(formId: string, values: Record<string, string>): Content {
  return { type: 'interaction', actionId: formId, value: JSON.stringify(values) };
}

/** Message content for an uploaded file: a voice message is `audio`; any other file carries the `documentType` it answers (or null). */
export function fileContent(file: { id: string; mimeType: string }, documentType: string | null): Content {
  return contentTypeFor(file.mimeType) === 'audio'
    ? { type: 'audio', fileId: file.id }
    : { type: 'file', fileId: file.id, documentType };
}
