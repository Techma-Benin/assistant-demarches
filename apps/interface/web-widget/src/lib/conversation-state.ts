import type { components } from '@techma/contracts-ts';
import type { UploadedFile } from './c1-client';
import { contentTypeFor } from './files';

type Schemas = components['schemas'];
export type Content = Schemas['Content'];
export type AgentMessage = Schemas['AgentMessage'];
export type EventPage = Schemas['EventPage'];

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
    }
  | { kind: 'agent'; message: AgentMessage };

export interface ConversationState {
  status: 'starting' | 'ready' | 'error';
  conversationId: string | null;
  cursor: string | null;
  seenEventIds: string[];
  timeline: TimelineEntry[];
  error?: string;
  /** The conversation can't be resumed (session expired, access denied, gone): only a new one helps. */
  lost?: boolean;
}

export const initialState: ConversationState = {
  status: 'starting',
  conversationId: null,
  cursor: null,
  seenEventIds: [],
  timeline: [],
};

export type ConversationAction =
  | { type: 'conversationStarted'; conversationId: string }
  | { type: 'startFailed'; error: string }
  | { type: 'conversationLost'; error: string }
  | { type: 'userMessageQueued'; id: string; content: Content; display: string; sentAt: string }
  | { type: 'userMessageAccepted'; id: string }
  | { type: 'userMessageFailed'; id: string }
  | { type: 'fileUploadStarted'; id: string; attachment: Attachment; sentAt: string }
  | { type: 'fileUploadSucceeded'; id: string; file: UploadedFile }
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
    case 'startFailed':
      return { ...state, status: 'error', error: action.error };
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
          },
        ],
      };
    case 'fileUploadSucceeded': {
      // Files are usable as soon as they are stored (no content scan, see docs/file-storage-decision.md).
      const { file } = action;
      return {
        ...state,
        timeline: updateUser(state.timeline, action.id, (e) => ({
          ...e,
          content: { type: contentTypeFor(file.mimeType), fileId: file.id },
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
      for (const event of action.page.items) {
        if (seen.has(event.id)) continue;
        const data = event.data;
        // Events of another conversation are ignored (and not marked as seen).
        if ('conversationId' in data && data.conversationId !== state.conversationId) continue;
        seen.add(event.id);
        if (data.kind === 'message.received') {
          timeline = setDelivery(timeline, data.messageId, 'received');
        } else if (data.kind === 'message.sent') {
          const message = data.message;
          if (!timeline.some((e) => e.kind === 'agent' && e.message.id === message.id)) {
            timeline = [...timeline, { kind: 'agent', message }];
          }
        }
        // Other kinds (request.*, mandate.*, tool.called, ...) are ignored for now.
      }
      return {
        ...state,
        seenEventIds: [...seen],
        timeline,
        cursor: action.page.nextCursor ?? state.cursor,
      };
    }
  }
}
