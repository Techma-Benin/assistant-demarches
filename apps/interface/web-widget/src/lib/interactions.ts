import type { components } from '@techma/contracts-ts';

type Content = components['schemas']['Content'];

export function buttonInteraction(item: { id: string; label: string }): Content {
  return { type: 'interaction', actionId: item.id };
}

/**
 * ATTENTION : l'encodage des réponses de formulaire n'est PAS défini par le
 * contrat v1. Le JSON dans `value` est un choix PROVISOIRE, en attente de la
 * confirmation du Backend. Garder cette décision isolée dans ce fichier.
 */
export function formInteraction(formId: string, values: Record<string, string>): Content {
  return { type: 'interaction', actionId: formId, value: JSON.stringify(values) };
}
