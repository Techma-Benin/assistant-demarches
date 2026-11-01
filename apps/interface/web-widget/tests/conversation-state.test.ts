import { describe, expect, it } from 'vitest';
import { activityLabel, conversationReducer, initialState, type ConversationState } from '@/lib/conversation-state';
import type { EventPage } from '@/lib/c1-client';

const CNV = 'cnv_' + '0'.repeat(25) + '1';
const OTHER = 'cnv_' + '0'.repeat(25) + '2';
const pad = (n: number) => String(n).padStart(26, '0');
const MSG = `msg_${pad(1)}`;

const sent = (evt: number, msg: number, conversationId = CNV): EventPage['items'][number] => ({
  specversion: '1.0',
  id: `evt_${pad(evt)}`,
  source: 'urn:techma:backend',
  type: 'bj.techma.message.sent.v1',
  time: '2026-10-22T18:00:00Z',
  datacontenttype: 'application/json',
  traceparent: '00-' + '1'.repeat(32) + '-' + '2'.repeat(16) + '-01',
  data: {
    kind: 'message.sent',
    conversationId,
    message: {
      id: `msg_${pad(msg)}`,
      conversationId,
      blocks: [{ type: 'text', text: 'Bonjour', sources: [] }],
      createdAt: '2026-10-22T18:00:00Z',
    },
  },
});
const received = (evt: number, messageId: string): EventPage['items'][number] => ({
  ...sent(evt, 99),
  type: 'bj.techma.message.received.v1',
  data: { kind: 'message.received', conversationId: CNV, messageId },
});
const page = (items: EventPage['items'], nextCursor: string | null): EventPage => ({ items, nextCursor });

function ready(): ConversationState {
  let s = conversationReducer(initialState, { type: 'conversationStarted', conversationId: CNV });
  s = conversationReducer(s, {
    type: 'userMessageQueued',
    id: MSG,
    content: { type: 'text', text: 'Salut' },
    display: 'Salut',
    sentAt: '2026-10-22T18:00:00Z',
  });
  return s;
}

describe('conversationReducer', () => {
  it('starts and fails', () => {
    expect(conversationReducer(initialState, { type: 'conversationStarted', conversationId: CNV }).status).toBe('ready');
    expect(conversationReducer(initialState, { type: 'startFailed', error: 'x' })).toMatchObject({
      status: 'error',
      error: 'x',
    });
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
    const p = page([sent(1, 1)], 'evt_' + pad(1));
    let s = conversationReducer(ready(), { type: 'eventsReceived', page: p });
    s = conversationReducer(s, { type: 'eventsReceived', page: p });
    expect(s.timeline.filter((e) => e.kind === 'agent')).toHaveLength(1);
  });

  it('appends message.sent once even if replayed with a new event id', () => {
    let s = conversationReducer(ready(), { type: 'eventsReceived', page: page([sent(1, 5)], `evt_${pad(1)}`) });
    s = conversationReducer(s, { type: 'eventsReceived', page: page([sent(2, 5)], `evt_${pad(2)}`) });
    expect(s.timeline.filter((e) => e.kind === 'agent')).toHaveLength(1);
  });

  it('marks delivery on message.received, even after accepted', () => {
    let s = conversationReducer(ready(), { type: 'eventsReceived', page: page([received(1, MSG)], `evt_${pad(1)}`) });
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
    const p = page([sent(1, 1), received(2, MSG)], `evt_${pad(2)}`);
    let s = conversationReducer(ready(), { type: 'eventsReceived', page: p });
    const before = s.timeline;
    s = conversationReducer(s, { type: 'replayExpired' });
    expect(s.cursor).toBeNull();
    s = conversationReducer(s, { type: 'eventsReceived', page: p });
    expect(s.timeline).toEqual(before);
  });

  it('ignores events of another conversation', () => {
    const s = conversationReducer(ready(), { type: 'eventsReceived', page: page([sent(1, 1, OTHER)], `evt_${pad(1)}`) });
    expect(s.timeline.filter((e) => e.kind === 'agent')).toHaveLength(0);
  });
});

describe('agent activity', () => {
  const tool = (evt: number, toolName: string, outcome: 'success' | 'error' = 'success', conversationId = CNV): EventPage['items'][number] => ({
    ...sent(evt, 99),
    type: 'bj.techma.tool.called.v1',
    time: '2026-10-22T18:00:05Z',
    data: { kind: 'tool.called', conversationId, toolName, outcome, code: outcome === 'success' ? 'OK' : 'INTERNAL' },
  });

  it('is set by a successful tool call of this conversation', () => {
    let s = ready();
    expect(s.activity).toBeNull();
    s = conversationReducer(s, { type: 'eventsReceived', page: page([tool(1, 'procedures.search')], 'evt_1') });
    expect(s.activity).toEqual({ toolName: 'procedures.search', at: '2026-10-22T18:00:05Z' });
    s = conversationReducer(s, { type: 'eventsReceived', page: page([tool(2, 'procedures.get')], 'evt_2') });
    expect(s.activity?.toolName).toBe('procedures.get');
  });

  it('ignores failed calls and calls of another conversation', () => {
    let s = ready();
    s = conversationReducer(s, { type: 'eventsReceived', page: page([tool(1, 'request.pay', 'error'), tool(2, 'request.pay', 'success', OTHER)], null) });
    expect(s.activity).toBeNull();
  });

  it('is cleared when an agent message arrives or a user message is queued', () => {
    let s = conversationReducer(ready(), { type: 'eventsReceived', page: page([tool(1, 'procedures.get')], null) });
    const answered = conversationReducer(s, { type: 'eventsReceived', page: page([sent(2, 2)], null) });
    expect(answered.activity).toBeNull();
    s = conversationReducer(s, {
      type: 'userMessageQueued',
      id: `msg_${pad(5)}`,
      content: { type: 'text', text: 'Suite' },
      display: 'Suite',
      sentAt: '2026-10-22T18:01:00Z',
    });
    expect(s.activity).toBeNull();
  });
});

describe('activityLabel', () => {
  it.each([
    ['procedures.search', 'Je consulte la fiche officielle…'],
    ['procedures.get', 'Je consulte la fiche officielle…'],
    ['request.create', 'Je prépare votre dossier…'],
    ['request.update', 'Je prépare votre dossier…'],
    ['documents.attach', 'Je vérifie votre pièce…'],
    ['documents.verify', 'Je vérifie votre pièce…'],
    ['request.submit', 'J’envoie votre demande…'],
    ['request.status', 'Je vérifie l’état de votre demande…'],
    ['request.pay', 'Je prépare le paiement…'],
    ['unknown.tool', 'Je réfléchis…'],
    [undefined, 'Je réfléchis…'],
  ])('%s', (tool, label) => {
    expect(activityLabel(tool)).toBe(label);
  });

  describe('message.transcribed (proposed 1.4.0)', () => {
    const transcribed = (evt: number, data: Record<string, unknown>): EventPage['items'][number] => ({
      ...sent(evt, 99),
      type: 'bj.techma.message.transcribed.v1' as never,
      data: { kind: 'message.transcribed', conversationId: CNV, messageId: MSG, ...data } as never,
    });
    const run = (item: EventPage['items'][number]) => conversationReducer(ready(), { type: 'eventsReceived', page: page([item], null) });

    it('sets a done transcript on the matching entry', () => {
      expect(run(transcribed(1, { status: 'done', text: 'Bonjour' })).timeline[0]).toMatchObject({
        transcript: { status: 'done', text: 'Bonjour' },
      });
    });
    it('sets a failed transcript', () => {
      expect(run(transcribed(1, { status: 'failed' })).timeline[0]).toMatchObject({ transcript: { status: 'failed' } });
    });
    it('ignores malformed, unknown-message and other-conversation events', () => {
      expect(run(transcribed(1, { status: 'done' })).timeline[0]).not.toHaveProperty('transcript');
      expect(run(transcribed(1, { status: 'done', text: '' })).timeline[0]).not.toHaveProperty('transcript');
      expect(run(transcribed(1, { status: 'done', text: 'x', messageId: `msg_${pad(7)}` })).timeline[0]).not.toHaveProperty('transcript');
      expect(run(transcribed(1, { status: 'done', text: 'x', conversationId: OTHER })).timeline[0]).not.toHaveProperty('transcript');
    });
    it('ignores a duplicate event id', () => {
      let s = run(transcribed(1, { status: 'done', text: 'Bonjour' }));
      s = conversationReducer(s, { type: 'eventsReceived', page: page([transcribed(1, { status: 'failed' })], null) });
      expect(s.timeline[0]).toMatchObject({ transcript: { status: 'done', text: 'Bonjour' } });
    });
  });
});
