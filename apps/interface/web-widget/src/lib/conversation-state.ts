import type { components } from '@techma/contracts-ts';
import type { UploadedFile } from './c1-client';
import { isMandateTriggerCode, type MandateTriggerCode } from './consent';
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

/** A tool needed a mandate (Backend `tool.called` error event). The card is shown after `anchorMessageId`. */
export interface ConsentNeeded {
  status: 'needed';
  toolName: string;
  eventId: string;
  code: MandateTriggerCode;
  /** First agent message received after the trigger (the one that announced it); null until then. */
  anchorMessageId: string | null;
}

export interface ConversationState {
  status: 'starting' | 'ready' | 'error';
  conversationId: string | null;
  cursor: string | null;
  seenEventIds: string[];
  timeline: TimelineEntry[];
  /** Procedure of the latest `request.created` event, if any. */
  requestProcedureId: string | null;
  consent?: ConsentNeeded;
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
  requestProcedureId: null,
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
      // Contract 1.3.0: no antivirus scan; an uploaded file is usable at once.
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
      let consent = state.consent;
      let requestProcedureId = state.requestProcedureId;
      for (const event of action.page.items) {
        if (seen.has(event.id)) continue;
        const data = event.data;
        // Events of another conversation are ignored (and not marked as seen).
        if ('conversationId' in data && data.conversationId !== state.conversationId) continue;
        seen.add(event.id);
        if (data.kind === 'message.received') {
          const message = data.message;
          const transcript = message.transcript?.trim() ?? '';
          const fallback =
            message.content.type === 'text' ? message.content.text : '';
          if (!timeline.some((entry) => entry.kind === 'user' && entry.id === message.id)) {
            timeline = [
              ...timeline,
              {
                kind: 'user',
                id: message.id,
                content: message.content,
                display: transcript || fallback,
                sentAt: message.sentAt,
                delivery: 'received',
              },
            ];
          } else {
            timeline = updateUser(timeline, message.id, (entry) => ({
              ...entry,
              delivery: 'received',
              content: entry.content ?? message.content,
              display: transcript || entry.display,
            }));
          }
        } else if (data.kind === 'message.sent') {
          const message = data.message;
          if (!timeline.some((e) => e.kind === 'agent' && e.message.id === message.id)) {
            timeline = [...timeline, { kind: 'agent', message }];
            if (consent && consent.anchorMessageId === null) consent = { ...consent, anchorMessageId: message.id };
          }
        } else if (data.kind === 'request.created') {
          if (data.request.conversationId === state.conversationId) requestProcedureId = data.request.procedureId;
        } else if (data.kind === 'tool.called' && data.outcome === 'error' && isMandateTriggerCode(data.code)) {
          // A trigger already waiting for its announcing message is the same agent turn: keep it.
          if (!consent || consent.anchorMessageId !== null) {
            consent = { status: 'needed', toolName: data.toolName, eventId: event.id, code: data.code, anchorMessageId: null };
          }
        }
        // Other kinds (request.status_changed, successful tool.called, ...) are ignored.
      }
      return {
        ...state,
        seenEventIds: [...seen],
        timeline,
        consent,
        requestProcedureId,
        cursor: action.page.nextCursor ?? state.cursor,
      };
    }
  }
}
