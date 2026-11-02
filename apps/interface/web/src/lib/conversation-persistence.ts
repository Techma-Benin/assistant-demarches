// Per tab and gone when the tab closes (shared computers): never localStorage.
// Only the conversation id is kept: the timeline is rebuilt from `GET …/events` (CONTRACTS.md §7.1.3).
const KEY = 'assistant-demarches:conversation:v2';

/** What survives a reload: the id of the conversation. */
export interface ConversationSnapshot {
  conversationId: string;
}

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function saveConversation(snapshot: ConversationSnapshot): void {
  try {
    storage()?.setItem(KEY, JSON.stringify({ conversationId: snapshot.conversationId }));
  } catch {
    // Private mode or quota: the conversation simply won't survive a reload.
  }
}

export function loadConversation(): ConversationSnapshot | null {
  try {
    const raw = storage()?.getItem(KEY);
    if (!raw) return null;
    const data: unknown = JSON.parse(raw);
    const id = typeof data === 'object' && data !== null ? (data as { conversationId?: unknown }).conversationId : undefined;
    return typeof id === 'string' && id !== '' ? { conversationId: id } : null;
  } catch {
    return null;
  }
}

export function clearConversation(): void {
  try {
    storage()?.removeItem(KEY);
    // The previous format kept the whole timeline: never leave it behind.
    storage()?.removeItem('assistant-demarches:conversation:v1');
  } catch {
    // Nothing to clear.
  }
}
