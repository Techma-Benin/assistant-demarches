const SESSION_CHANGED = 'techma:session-changed';

/** The server session changed without a page load (simulated NPI sign-in). */
export function announceSessionChanged(): void {
  window.dispatchEvent(new Event(SESSION_CHANGED));
}

/** Runs `listener` on each change; returns the unsubscribe function. */
export function onSessionChanged(listener: () => void): () => void {
  window.addEventListener(SESSION_CHANGED, listener);
  return () => window.removeEventListener(SESSION_CHANGED, listener);
}
