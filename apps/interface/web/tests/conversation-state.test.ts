import { describe, expect, it } from 'vitest';
import { conversationReducer, initialState, type ConversationState } from '@/lib/conversation-state';
import type { EventPage } from '@/lib/c1-client';
import { CONVERSATION_ID as CNV, agentEvent, evtId, msgId, textBlock, userEvent } from './fixtures-v2';

const OTHER = 'cnv_' + '0'.repeat(25) + '2';
const MSG = msgId(1);

const sent = (evt: number, msg: number, conversationId = CNV) =>
  ({
    ...agentEvent(evt, [textBlock('Bonjour')], conversationId),
    data: {
      kind: 'message.sent' as const,
      conversationId,
      message: { id: msgId(msg), conversationId, blocks: [textBlock('Bonjour')], createdAt: '2026-11-02T09:00:00Z' },
    },
  }) as EventPage['items'][number];
const received = (evt: number, messageId: string) =>
  userEvent(evt, { type: 'text', text: 'Salut' }, { messageId }) as EventPage['items'][number];
const page = (items: EventPage['items'], nextCursor: string | null): EventPage => ({ items, nextCursor });

function ready(): ConversationState {
  let s = conversationReducer(initialState, { type: 'conversationStarted', conversationId: CNV });
  s = conversationReducer(s, {
    type: 'userMessageQueued',
    id: MSG,
    content: { type: 'text', text: 'Salut' },
    display: 'Salut',
    sentAt: '2026-11-02T09:00:00Z',
  });
  return s;
}

describe('conversationReducer', () => {
  it('is idle before the first message, starts, and falls back to idle when the start fails', () => {
    expect(initialState.status).toBe('idle');
    expect(conversationReducer(initialState, { type: 'conversationStarting' }).status).toBe('starting');
    expect(conversationReducer(initialState, { type: 'conversationStarted', conversationId: CNV })).toMatchObject({
      status: 'ready',
      conversationId: CNV,
    });
    const starting = conversationReducer(initialState, { type: 'conversationStarting' });
    expect(conversationReducer(starting, { type: 'startFailed' }).status).toBe('idle');
  });

  it('tracks delivery accepted / failed / retry', () => {
    let s = ready();
    s = conversationReducer(s, { type: 'userMessageFailed', id: MSG });
    expect(s.timeline[0]).toMatchObject({ delivery: 'failed' });
    s = conversationReducer(s, { type: 'userMessageQueued', id: MSG, content: { type: 'text', text: 'Salut' }, display: '', sentAt: '' });
    expect(s.timeline).toHaveLength(1);
    expect(s.timeline[0]).toMatchObject({ delivery: 'sending', display: 'Salut' });
    s = conversationReducer(s, { type: 'userMessageAccepted', id: MSG });
    expect(s.timeline[0]).toMatchObject({ delivery: 'accepted' });
  });

  it('dedupes events by id', () => {
    const p = page([sent(1, 1)], evtId(1));
    let s = conversationReducer(ready(), { type: 'eventsReceived', page: p });
    s = conversationReducer(s, { type: 'eventsReceived', page: p });
    expect(s.timeline.filter((e) => e.kind === 'agent')).toHaveLength(1);
  });

  it('appends message.sent once even if replayed with a new event id', () => {
    let s = conversationReducer(ready(), { type: 'eventsReceived', page: page([sent(1, 5)], evtId(1)) });
    s = conversationReducer(s, { type: 'eventsReceived', page: page([sent(2, 5)], evtId(2)) });
    expect(s.timeline.filter((e) => e.kind === 'agent')).toHaveLength(1);
  });

  it('marks delivery on message.received, even after accepted', () => {
    let s = conversationReducer(ready(), { type: 'eventsReceived', page: page([received(1, MSG)], evtId(1)) });
    expect(s.timeline[0]).toMatchObject({ delivery: 'received' });
    s = conversationReducer(s, { type: 'userMessageAccepted', id: MSG });
    expect(s.timeline[0]).toMatchObject({ delivery: 'received' });
  });

  it('updates the cursor and keeps it when nextCursor is null', () => {
    let s = conversationReducer(ready(), { type: 'eventsReceived', page: page([sent(1, 1)], 'evt_A') });
    expect(s.cursor).toBe('evt_A');
    s = conversationReducer(s, { type: 'eventsReceived', page: page([], null) });
    expect(s.cursor).toBe('evt_A');
  });

  it('replayExpired resets the cursor without duplicating the timeline', () => {
    const p = page([sent(1, 1), received(2, MSG)], evtId(2));
    let s = conversationReducer(ready(), { type: 'eventsReceived', page: p });
    const before = s.timeline;
    s = conversationReducer(s, { type: 'replayExpired' });
    expect(s.cursor).toBeNull();
    s = conversationReducer(s, { type: 'eventsReceived', page: p });
    expect(s.timeline).toEqual(before);
  });

  it('ignores events of another conversation', () => {
    const s = conversationReducer(ready(), { type: 'eventsReceived', page: page([sent(1, 1, OTHER)], evtId(1)) });
    expect(s.timeline.filter((e) => e.kind === 'agent')).toHaveLength(0);
  });

  it('ignores every kind but message.received and message.sent (CONTRACTS.md §12)', () => {
    const tool = {
      ...agentEvent(1, [textBlock('x')]),
      type: 'bj.techma.tool.called.v2',
      data: { kind: 'tool.called', conversationId: CNV, toolName: 'request.create', outcome: 'error', code: 'MANDATE_MISSING' },
    } as EventPage['items'][number];
    const s = conversationReducer(ready(), { type: 'eventsReceived', page: page([tool], evtId(1)) });
    expect(s.timeline).toHaveLength(1);
    expect(s.seenEventIds).toContain(evtId(1));
  });
});

describe('history rebuild (message.received)', () => {
  const rebuild = (...items: EventPage['items']) => {
    const start = conversationReducer(initialState, { type: 'conversationStarted', conversationId: CNV });
    return conversationReducer(start, { type: 'eventsReceived', page: page(items, null) });
  };

  it('rebuilds the user messages and the agent answers in event order', () => {
    const s = rebuild(userEvent(1, { type: 'text', text: 'Comment obtenir mon casier ?' }), sent(2, 2), userEvent(3, { type: 'text', text: 'Merci' }));
    expect(s.timeline.map((e) => e.kind)).toEqual(['user', 'agent', 'user']);
    expect(s.timeline[0]).toMatchObject({
      id: msgId(1),
      display: 'Comment obtenir mon casier ?',
      delivery: 'received',
      content: { type: 'text', text: 'Comment obtenir mon casier ?' },
    });
  });

  it('rebuilds a voice message with its transcript', () => {
    const s = rebuild(userEvent(1, { type: 'audio', fileId: 'fil_' + '0'.repeat(26) }, { transcript: 'Bonjour, je veux un extrait' }));
    expect(s.timeline[0]).toMatchObject({
      kind: 'user',
      display: 'Message vocal',
      attachment: { mimeType: 'audio/*' },
      transcript: { status: 'done', text: 'Bonjour, je veux un extrait' },
    });
  });

  it('adds the transcript to a voice message sent from this tab, under the same id', () => {
    let s = conversationReducer(initialState, { type: 'conversationStarted', conversationId: CNV });
    s = conversationReducer(s, {
      type: 'userMessageQueued',
      id: MSG,
      content: { type: 'audio', fileId: 'fil_' + '0'.repeat(26) },
      display: 'Message vocal',
      sentAt: '2026-11-02T09:00:00Z',
    });
    s = conversationReducer(s, {
      type: 'eventsReceived',
      page: page([userEvent(1, { type: 'audio', fileId: 'fil_' + '0'.repeat(26) }, { messageId: MSG, transcript: 'Salut' })], null),
    });
    expect(s.timeline).toHaveLength(1);
    expect(s.timeline[0]).toMatchObject({ delivery: 'received', transcript: { status: 'done', text: 'Salut' } });
  });

  it('labels a rebuilt button click with the button of the previous answer, and a form as sent', () => {
    const buttons = {
      ...agentEvent(1, [{ type: 'buttons', items: [{ id: 'prepare', label: 'Préparer ma demande' }] }]),
    } as EventPage['items'][number];
    const form = agentEvent(3, [
      { type: 'form', id: 'identity', fields: [{ name: 'profession', label: 'Profession', required: true, type: 'text' }] },
    ]) as EventPage['items'][number];
    const s = rebuild(
      buttons,
      userEvent(2, { type: 'interaction', actionId: 'prepare', value: null }),
      form,
      userEvent(4, { type: 'interaction', actionId: 'identity', value: '{"profession":"Comptable"}' }),
    );
    const users = s.timeline.filter((e) => e.kind === 'user');
    expect(users[0]).toMatchObject({ display: 'Préparer ma demande' });
    expect(users[1]).toMatchObject({ display: 'Formulaire envoyé' });
  });

  it('rebuilds a file as an attachment without size', () => {
    const s = rebuild(userEvent(1, { type: 'file', fileId: 'fil_' + '0'.repeat(26), documentType: 'extrait-acte-naissance' }));
    expect(s.timeline[0]).toMatchObject({ display: 'Pièce jointe', attachment: { sizeBytes: 0 } });
  });
});
