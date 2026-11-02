import type { Schemas } from '@techma/contracts-ts';
import type { UploadedFile } from './c1-client';
import { fileContent } from './interactions';

export type Content = Schemas['Content'];
export type AgentMessage = Schemas['AgentMessage'];
export type EventPage = Schemas['EventPage'];
export type Block = Schemas['Block'];
export type UserMessage = Schemas['UserMessage'];

export type Delivery =
  | 'uploading'
  | 'uploadFailed'
  | 'sending'
  | 'accepted'
  | 'received'
  | 'failed';

export interface Attachment {
  name: string;
  sizeBytes: number;
  mimeType: string;
  /** Local blob URL for image thumbnails and voice playback; never sent to the backend. */
  previewUrl?: string;
  /** Voice messages only, local: recorded duration and 32 waveform bars in 0..1. */
  durationMs?: number;
  waveform?: number[];
}

export type TimelineEntry =
  | {
      kind: 'user';
      id: string;
      // null while an attached file is not uploaded yet.
      content: Content | null;
      display: string;
      sentAt: string;
      delivery: Delivery;
      attachment?: Attachment;
      error?: string;
      retryable?: boolean;
      /** Entries of one send (files + note) share a batchId and render as one turn. */
      batchId?: string;
      /** Voice message transcription, when the Backend sends it. */
      transcript?: { status: 'done'; text: string } | { status: 'failed' };
    }
  | { kind: 'agent'; message: AgentMessage };

/**
 * Live text of a reply still being written (`message.delta`, CONTRACTS.md §7.1). Never in the history: it only
 * exists between the first delta and the `message.sent` of the same `messageId`, which replaces it.
 */
export interface LiveDraft {
  messageId: string;
  /** Text accumulated so far (ordered by `index` when the deltas carry one). */
  text: string;
  /** Deltas that carry an `index`, by index (a repeated index is ignored). */
  indexed: Record<number, string>;
  /** Deltas without `index`, in arrival order. */
  plain: string;
  /** Timeline length when the first delta arrived: where the final message is inserted. */
  at: number;
}

/** Neutral line shown while the assistant answers (the v2 stream carries no tool activity). */
export const WAITING_LABEL = 'L’assistant prépare sa réponse';

export interface ConversationState {
  /** `idle`: no conversation yet, it is created with the visitor's first message. */
  status: 'idle' | 'starting' | 'ready' | 'error';
  conversationId: string | null;
  cursor: string | null;
  seenEventIds: string[];
  timeline: TimelineEntry[];
  /** Replies being written live; a draft is dropped when its `message.sent` arrives. */
  drafts: LiveDraft[];
  error?: string;
  /** The conversation can't be resumed (session expired, access denied, gone): only a new one helps. */
  lost?: boolean;
}

export const initialState: ConversationState = {
  status: 'idle',
  conversationId: null,
  cursor: null,
  seenEventIds: [],
  timeline: [],
  drafts: [],
};

export type ConversationAction =
  | { type: 'conversationStarting' }
  | { type: 'conversationStarted'; conversationId: string }
  | { type: 'startFailed' }
  | { type: 'conversationLost'; error: string }
  | { type: 'userMessageQueued'; id: string; content: Content; display: string; sentAt: string; batchId?: string }
  | { type: 'userMessageAccepted'; id: string }
  | { type: 'userMessageFailed'; id: string }
  | { type: 'fileUploadStarted'; id: string; attachment: Attachment; sentAt: string; batchId?: string }
  | { type: 'fileUploadSucceeded'; id: string; file: UploadedFile; documentType: string | null }
  | { type: 'fileUploadFailed'; id: string; error: string; retryable: boolean }
  | { type: 'eventsReceived'; page: EventPage }
  | { type: 'replayExpired' };

function setDelivery(
  timeline: TimelineEntry[],
  id: string,
  delivery: Delivery,
  onlyFrom?: Delivery[],
): TimelineEntry[] {
  return timeline.map((entry) =>
    entry.kind === 'user' && entry.id === id && (!onlyFrom || onlyFrom.includes(entry.delivery))
      ? { ...entry, delivery }
      : entry,
  );
}

function updateUser(
  timeline: TimelineEntry[],
  id: string,
  update: (entry: Extract<TimelineEntry, { kind: 'user' }>) => Extract<TimelineEntry, { kind: 'user' }>,
): TimelineEntry[] {
  return timeline.map((entry) => (entry.kind === 'user' && entry.id === id ? update(entry) : entry));
}

export function conversationReducer(state: ConversationState, action: ConversationAction): ConversationState {
  switch (action.type) {
    case 'conversationStarted':
      return { ...state, status: 'ready', conversationId: action.conversationId, error: undefined };
    case 'conversationStarting':
      return state.status === 'idle' ? { ...state, status: 'starting', error: undefined } : state;
    case 'startFailed':
      // Not a dead end: the next send tries again. The queued message shows « Réessayer ».
      return state.conversationId ? state : { ...state, status: 'idle' };
    case 'conversationLost':
      return { ...state, status: 'error', error: action.error, lost: true };
    case 'userMessageQueued':
      if (state.timeline.some((e) => e.kind === 'user' && e.id === action.id)) {
        // Retry of a failed message: same id, back to "sending".
        return { ...state, timeline: setDelivery(state.timeline, action.id, 'sending') };
      }
      return {
        ...state,
        timeline: [
          ...state.timeline,
          {
            kind: 'user',
            id: action.id,
            content: action.content,
            display: action.display,
            sentAt: action.sentAt,
            delivery: 'sending',
            batchId: action.batchId,
          },
        ],
      };
    case 'fileUploadStarted':
      if (state.timeline.some((e) => e.kind === 'user' && e.id === action.id)) {
        // Retry of a failed upload: same id, back to "uploading".
        return {
          ...state,
          timeline: updateUser(state.timeline, action.id, (e) => ({
            ...e,
            delivery: 'uploading',
            error: undefined,
            retryable: undefined,
          })),
        };
      }
      return {
        ...state,
        timeline: [
          ...state.timeline,
          {
            kind: 'user',
            id: action.id,
            content: null,
            display: action.attachment.name,
            sentAt: action.sentAt,
            delivery: 'uploading',
            attachment: action.attachment,
            batchId: action.batchId,
          },
        ],
      };
    case 'fileUploadSucceeded': {
      const { file } = action;
      return {
        ...state,
        timeline: updateUser(state.timeline, action.id, (e) => ({
          ...e,
          content: fileContent(file, action.documentType),
          delivery: 'sending',
          error: undefined,
          retryable: undefined,
        })),
      };
    }
    case 'fileUploadFailed':
      return {
        ...state,
        timeline: updateUser(state.timeline, action.id, (e) => ({
          ...e,
          delivery: 'uploadFailed',
          error: action.error,
          retryable: action.retryable,
        })),
      };
    case 'userMessageAccepted':
      // The message.received event may already have been applied: never downgrade.
      return { ...state, timeline: setDelivery(state.timeline, action.id, 'accepted', ['sending', 'failed']) };
    case 'userMessageFailed':
      return { ...state, timeline: setDelivery(state.timeline, action.id, 'failed', ['sending']) };
    case 'replayExpired':
      // Cursor lost: restart from the beginning; seenEventIds dedupe keeps the timeline unchanged.
      return { ...state, cursor: null };
    case 'eventsReceived': {
      const seen = new Set(state.seenEventIds);
      let timeline = state.timeline;
      let drafts = state.drafts ?? [];
      for (const event of action.page.items) {
        if (seen.has(event.id)) continue;
        const data = event.data;
        // Events of another conversation are ignored (and not marked as seen).
        if ('conversationId' in data && data.conversationId !== state.conversationId) continue;
        seen.add(event.id);
        if (data.kind === 'message.received') {
          timeline = applyUserMessage(timeline, data.message);
        } else if (data.kind === 'message.sent') {
          const message = data.message;
          const draft = drafts.find((d) => d.messageId === message.id);
          if (draft) drafts = drafts.filter((d) => d !== draft);
          if (!timeline.some((e) => e.kind === 'agent' && e.message.id === message.id)) {
            // The final message takes the place of the live bubble.
            const at = draft ? Math.min(draft.at, timeline.length) : timeline.length;
            timeline = [...timeline.slice(0, at), { kind: 'agent', message }, ...timeline.slice(at)];
          }
        } else if (data.kind === 'message.delta') {
          // Late delta (its message.sent is already there): ignored.
          if (!timeline.some((e) => e.kind === 'agent' && e.message.id === data.messageId)) {
            drafts = applyDelta(drafts, data, timeline.length);
          }
        }
        // Other kinds are ignored (CONTRACTS.md §12).
      }
      return {
        ...state,
        seenEventIds: [...seen],
        timeline,
        drafts,
        cursor: action.page.nextCursor ?? state.cursor,
      };
    }
  }
}

function applyDelta(
  drafts: LiveDraft[],
  data: { messageId: string; delta: string; index?: number },
  at: number,
): LiveDraft[] {
  const current = drafts.find((d) => d.messageId === data.messageId);
  const base: LiveDraft = current ?? { messageId: data.messageId, text: '', indexed: {}, plain: '', at };
  let { indexed, plain } = base;
  if (data.index === undefined) plain += data.delta;
  else if (data.index in indexed) return drafts;
  else indexed = { ...indexed, [data.index]: data.delta };
  const ordered = Object.keys(indexed)
    .map(Number)
    .sort((a, b) => a - b)
    .map((i) => indexed[i])
    .join('');
  const next: LiveDraft = { ...base, indexed, plain, text: ordered + plain };
  return current ? drafts.map((d) => (d === current ? next : d)) : [...drafts, next];
}

/** What the visitor sees for a message rebuilt from the history (nothing local remembers it). */
function describeUserMessage(message: UserMessage, timeline: TimelineEntry[]): { display: string; attachment?: Attachment } {
  const { content } = message;
  switch (content.type) {
    case 'text':
      return { display: content.text };
    case 'audio':
      return { display: VOICE_LABEL, attachment: { name: VOICE_LABEL, sizeBytes: 0, mimeType: 'audio/*' } };
    case 'file':
      return { display: FILE_LABEL, attachment: { name: FILE_LABEL, sizeBytes: 0, mimeType: 'application/octet-stream' } };
    case 'interaction': {
      for (let i = timeline.length - 1; i >= 0; i--) {
        const entry = timeline[i];
        if (entry.kind !== 'agent') continue;
        for (const block of entry.message.blocks) {
          if (block.type === 'buttons') {
            const item = block.items.find((candidate) => candidate.id === content.actionId);
            if (item) return { display: item.label };
          }
          if (block.type === 'form' && block.id === content.actionId) return { display: FORM_SENT_LABEL };
        }
      }
      return { display: content.value ?? content.actionId };
    }
  }
}

export const VOICE_LABEL = 'Message vocal';
export const FILE_LABEL = 'Pièce jointe';
export const FORM_SENT_LABEL = 'Formulaire envoyé';

/**
 * `message.received`: the server's copy of a user message. A message sent from this tab is confirmed (and gets its
 * transcript); one that is not in the timeline (reload, other device) is rebuilt from the event.
 */
function applyUserMessage(timeline: TimelineEntry[], message: UserMessage): TimelineEntry[] {
  const transcript: Extract<TimelineEntry, { kind: 'user' }>['transcript'] =
    message.transcript && message.transcript !== '' ? { status: 'done', text: message.transcript } : undefined;
  if (timeline.some((e) => e.kind === 'user' && e.id === message.id)) {
    return updateUser(timeline, message.id, (e) => ({
      ...e,
      delivery: 'received',
      transcript: transcript ?? e.transcript,
    }));
  }
  const { display, attachment } = describeUserMessage(message, timeline);
  return [
    ...timeline,
    {
      kind: 'user',
      id: message.id,
      content: message.content,
      display,
      sentAt: message.sentAt,
      delivery: 'received',
      attachment,
      transcript,
    },
  ];
}
