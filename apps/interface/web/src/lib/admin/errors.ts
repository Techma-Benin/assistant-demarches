import type { Schemas } from '@techma/contracts-ts';

export type Problem = Partial<Schemas['Problem']>;

/** A non-2xx answer of the console routes (`application/problem+json` when the Backend sent one). */
export class AdminError extends Error {
  readonly status: number;
  readonly problem?: Problem;

  constructor(status: number, problem?: Problem) {
    super(problem?.detail ?? `Erreur de la console (HTTP ${status})`);
    this.name = 'AdminError';
    this.status = status;
    this.problem = problem;
  }
}

export interface Failure {
  message: string;
  /** The resource changed meanwhile (409): the caller reloads it. */
  conflict: boolean;
  /** Network or 5xx failure: retrying the same request is safe with the same idempotency key. */
  retryable: boolean;
}

const UNAVAILABLE = 'Service indisponible. Réessayez.';

/** Maps a failed console request to a user message; the server’s own detail is shown for 400 and 409. */
export function toFailure(error: unknown): Failure {
  if (!(error instanceof AdminError)) return { message: UNAVAILABLE, conflict: false, retryable: true };
  const { status, problem } = error;
  const detail = problem?.detail;
  const final = (message: string, conflict = false): Failure => ({ message, conflict, retryable: false });
  if (status === 400) return final(detail ? `Données refusées : ${detail}` : 'Données refusées.');
  if (status === 401) return final('Votre session a expiré. Reconnectez-vous.');
  if (status === 403) return final('Vous n’avez pas le droit d’effectuer cette action.');
  if (status === 404) return final('Cette ressource n’existe plus ou n’est pas accessible.');
  if (status === 409) {
    if (problem?.code === 'INVALID_TRANSITION') {
      return final(detail ?? 'Cette action n’est plus possible : le dossier a changé de statut.', true);
    }
    if (problem?.code === 'IDEMPOTENCY_CONFLICT') {
      return final(detail ?? 'Cette action a déjà été envoyée avec un contenu différent.', true);
    }
    return final(detail ?? 'Cette ressource a été modifiée entre-temps. Rechargez la page.', true);
  }
  if (status === 413) return final('Fichier trop volumineux (2 Mio maximum).');
  if (status === 415) return final('Format non pris en charge : JPEG ou PNG uniquement.');
  if (status === 429) return { message: 'Trop de requêtes. Réessayez dans un instant.', conflict: false, retryable: true };
  if (status >= 500) return { message: UNAVAILABLE, conflict: false, retryable: true };
  return final('L’opération a échoué.');
}
