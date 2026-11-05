import type { Case } from './api';

type Listener = (item: Case) => void;

const listeners = new Set<Listener>();

/** The detail page’s getCase / act already load the case; the shell listens instead of fetching again. */
export function subscribeLoadedCase(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function emitLoadedCase(item: Case): void {
  for (const listener of listeners) listener(item);
}
