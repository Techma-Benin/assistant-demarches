import { C3Error } from '@/lib/operator/c3-client';
import { toSaveFailure, type SaveFailure } from './error-messages';

export const CONFLICT_MESSAGE = 'Le dossier a changé entre-temps';

/** Maps a failed console action (agent intervention, resolution) to a user message. */
export function toActionFailure(error: unknown): SaveFailure {
  if (error instanceof C3Error) {
    if (error.status === 409) return { message: CONFLICT_MESSAGE, conflict: true, retryable: false };
    if (error.status === 403) {
      return { message: 'Vous n’avez pas le droit d’agir sur ce ministère.', conflict: false, retryable: false };
    }
    if (error.status === 404) return { message: 'Ce dossier n’existe plus.', conflict: false, retryable: false };
  }
  return toSaveFailure(error);
}
