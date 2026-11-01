import type { ConversationState, Delivery, TimelineEntry } from './conversation-state';

// Per tab and gone when the tab closes (shared computers): never localStorage.
const KEY = 'assistant-demarches:conversation:v1';
const VERSION = 1;
const MAX_BYTES = 1_500_000;

export interface PersistedMandate {
  id: string;
  expiresAt: string;
}

/** What survives a reload: the reducer state minus transient bits, plus an active mandate. */
export interface ConversationSnapshot {
  conversationId: string;
  cursor: string | null;
  seenEventIds: string[];
  timeline: TimelineEntry[];
  requestProcedureId: string | null;
  consent?: ConversationState['consent'];
  mandate: PersistedMandate | null;
}

export const UPLOAD_INTERRUPTED = 'Envoi interrompu. Joignez à nouveau la pièce.';

const DELIVERIES: Delivery[] = ['uploading', 'uploadFailed', 'sending', 'accepted', 'received', 'failed'];

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

const isString = (value: unknown): value is string => typeof value === 'string';
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function validEntry(value: unknown): value is TimelineEntry {
  if (!isRecord(value)) return false;
  if (value.kind === 'agent') {
    return isRecord(value.message) && isString(value.message.id) && Array.isArray(value.message.blocks);
  }
  return (
    value.kind === 'user' &&
    isString(value.id) &&
    isString(value.display) &&
    isString(value.sentAt) &&
    DELIVERIES.includes(value.delivery as Delivery) &&
    (value.content === null || isRecord(value.content)) &&
    (value.attachment === undefined || (isRecord(value.attachment) && isString(value.attachment.name)))
  );
}

function validMandate(value: unknown): value is PersistedMandate {
  return isRecord(value) && isString(value.id) && isString(value.expiresAt);
}

/** Blob URLs die with the page. */
function stripPreview(entry: TimelineEntry): TimelineEntry {
  if (entry.kind !== 'user' || !entry.attachment || entry.attachment.previewUrl === undefined) return entry;
  const { previewUrl: _previewUrl, ...attachment } = entry.attachment;
  return { ...entry, attachment };
}

/** An interrupted send cannot finish: text can be retried from its content, a file must be attached again. */
function settle(entry: TimelineEntry): TimelineEntry {
  if (entry.kind !== 'user') return entry;
  if (entry.delivery === 'sending') return { ...entry, delivery: 'failed' };
  if (entry.delivery === 'uploading') {
    return { ...entry, delivery: 'uploadFailed', error: UPLOAD_INTERRUPTED, retryable: false };
  }
  return entry;
}

export function saveConversation(snapshot: ConversationSnapshot): void {
  const store = storage();
  if (!store) return;
  try {
    const base = {
      version: VERSION,
      conversationId: snapshot.conversationId,
      cursor: snapshot.cursor,
      timeline: snapshot.timeline.map(stripPreview),
      requestProcedureId: snapshot.requestProcedureId,
      consent: snapshot.consent,
      mandate: snapshot.mandate,
    };
    let seen = snapshot.seenEventIds;
    let json = JSON.stringify({ ...base, seenEventIds: seen });
    // Too big: forget the oldest event ids first (the cursor already skips them).
    while (json.length > MAX_BYTES && seen.length > 0) {
      seen = seen.slice(Math.ceil(seen.length / 2));
      json = JSON.stringify({ ...base, seenEventIds: seen });
    }
    if (json.length > MAX_BYTES) return;
    store.setItem(KEY, json);
  } catch {
    // Private mode or quota: the conversation simply won't survive a reload.
  }
}

export function loadConversation(): ConversationSnapshot | null {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(KEY);
    if (!raw) return null;
    const data: unknown = JSON.parse(raw);
    if (!isRecord(data) || data.version !== VERSION) return null;
    const { conversationId, cursor, seenEventIds, timeline, requestProcedureId, consent, mandate } = data;
    if (!isString(conversationId) || conversationId === '') return null;
    if (cursor !== null && !isString(cursor)) return null;
    if (!Array.isArray(seenEventIds) || !seenEventIds.every(isString)) return null;
    if (!Array.isArray(timeline) || timeline.length === 0 || !timeline.every(validEntry)) return null;
    if (requestProcedureId !== null && !isString(requestProcedureId)) return null;
    if (consent !== undefined && !(isRecord(consent) && consent.status === 'needed' && isString(consent.eventId))) return null;
    if (mandate !== null && !validMandate(mandate)) return null;
    return {
      conversationId,
      cursor,
      seenEventIds,
      timeline: timeline.map((entry) => settle(stripPreview(entry))),
      requestProcedureId,
      consent: consent as ConversationSnapshot['consent'],
      mandate,
    };
  } catch {
    return null;
  }
}

export function clearConversation(): void {
  try {
    storage()?.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
}
