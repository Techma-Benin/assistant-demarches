import { C3Error } from './c3-client';

export interface SaveFailure {
  message: string;
  /** 409: the resource changed meanwhile, offer a reload. */
  conflict: boolean;
  /** Network or 5xx failure: retrying the same request is safe with the same idempotency key. */
  retryable: boolean;
}

const UNAVAILABLE = 'Service indisponible. Réessayez.';

/** Maps a failed PUT to a user message (never exposes technical details). */
export function toSaveFailure(error: unknown): SaveFailure {
  if (!(error instanceof C3Error)) return { message: UNAVAILABLE, conflict: false, retryable: true };
  const { status, problem } = error;
  if (status === 400) {
    const detail = problem?.detail;
    return { message: detail ? `Données refusées : ${detail}` : 'Données refusées.', conflict: false, retryable: false };
  }
  if (status === 403) {
    return { message: 'Droits insuffisants : il faut le droit admin:write.', conflict: false, retryable: false };
  }
  if (status === 404) return { message: 'Cette ressource n’existe plus.', conflict: false, retryable: false };
  if (status === 409) {
    return {
      message: 'Cette ressource a été modifiée entre-temps. Rechargez la page avant de recommencer.',
      conflict: true,
      retryable: false,
    };
  }
  if (status === 503) return { message: UNAVAILABLE, conflict: false, retryable: true };
  return { message: 'Impossible d’enregistrer les modifications.', conflict: false, retryable: status >= 500 };
}
