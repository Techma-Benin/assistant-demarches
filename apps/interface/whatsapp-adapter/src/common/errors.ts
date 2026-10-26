/** Erreur qui peut être retentée par une file (réseau, 429, 5xx). */
export interface RetryableLike {
  retryable: boolean;
}

export const isRetryable = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as Partial<RetryableLike>).retryable === true;

/** Description sûre pour les journaux : jamais de message libre venant d’un tiers. */
export function describeError(error: unknown): string {
  if (error instanceof Error) {
    const extra = error as Error & { status?: number; code?: string };
    return [error.name, extra.status !== undefined ? `status=${extra.status}` : '', extra.code ? `code=${extra.code}` : '']
      .filter(Boolean)
      .join(' ');
  }
  return 'erreur inconnue';
}
