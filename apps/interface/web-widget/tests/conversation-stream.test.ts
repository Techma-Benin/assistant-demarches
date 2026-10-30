import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { C1Error, type ConversationEvent } from '@/lib/c1-client';
import { ConversationStream, type StreamStatus } from '@/lib/conversation-stream';

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  readonly url: string;
  closedWith: { code?: number; reason?: string } | null = null;
  private listeners: Record<string, ((event: never) => void)[]> = {};

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }
  addEventListener(type: string, fn: (event: never) => void) {
    (this.listeners[type] ??= []).push(fn);
  }
  private emit(type: string, event: object) {
    for (const fn of this.listeners[type] ?? []) fn(event as never);
  }
  open() {
    this.emit('open', {});
  }
  message(data: unknown) {
    this.emit('message', { data });
  }
  serverClose(code: number, reason = '') {
    this.emit('close', { code, reason });
  }
  close(code?: number, reason?: string) {
    this.closedWith = { code, reason };
  }
}

const evt = (id: string, kind = 'message.received') =>
  ({ id, data: { kind, conversationId: 'cnv_1', messageId: 'msg_1' } }) as unknown as ConversationEvent;

function setup(
  overrides: {
    online?: () => boolean;
    listEvents?: ReturnType<typeof vi.fn>;
    createSocketTicket?: ReturnType<typeof vi.fn>;
  } = {},
) {
  let n = 0;
  const createSocketTicket =
    overrides.createSocketTicket ??
    vi.fn(async (_cid: string, _key: string) => {
      n++;
      return { ticket: `tkt_secret${n}`, expiresAt: '', url: `ws://127.0.0.1:1/v1/stream?ticket=tkt_secret${n}` };
    });
  const listEvents = overrides.listEvents ?? vi.fn(async () => ({ items: [], nextCursor: null }));
  const events: ConversationEvent[] = [];
  const statuses: StreamStatus[] = [];
  const onReplayExpired = vi.fn();
  const onFatal = vi.fn();
  const stream = new ConversationStream({
    client: { createSocketTicket, listEvents } as never,
    conversationId: 'cnv_1',
    onEvents: (items) => events.push(...items),
    onReplayExpired,
    onStatus: (s) => statuses.push(s),
    onFatal,
    WebSocketImpl: FakeWebSocket as never,
    isOnline: overrides.online,
  });
  return { stream, createSocketTicket, listEvents, events, statuses, onReplayExpired, onFatal };
}

const last = () => FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers();
  FakeWebSocket.instances = [];
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('ConversationStream permanent failures', () => {
  it('stops for good when the ticket request returns 404', async () => {
    const createSocketTicket = vi.fn(async () => {
      throw new C1Error(404);
    });
    const t = setup({ createSocketTicket });
    t.stream.start();
    await flush();
    expect(t.onFatal).toHaveBeenCalledWith(404);
    expect(t.listEvents).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(createSocketTicket).toHaveBeenCalledTimes(1);
  });

  it('stops for good when polling returns 401', async () => {
    const listEvents = vi.fn(async () => {
      throw new C1Error(401);
    });
    const t = setup({ listEvents });
    t.stream.start();
    await flush();
    last().serverClose(1006);
    await flush();
    expect(t.onFatal).toHaveBeenCalledWith(401);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(t.createSocketTicket).toHaveBeenCalledTimes(1);
    expect(listEvents).toHaveBeenCalledTimes(1);
  });
});

describe('ConversationStream', () => {
  it('connects once with a fresh key, no cursor, connecting -> live', async () => {
    const t = setup();
    t.stream.start();
    await flush();
    expect(t.createSocketTicket).toHaveBeenCalledTimes(1);
    expect(t.createSocketTicket.mock.calls[0][1]).toMatch(/^[0-9a-f-]{36}$/);
    expect(last().url).not.toContain('cursor=');
    last().open();
    expect(t.statuses).toEqual(['connecting', 'live']);
    t.stream.stop();
  });

  it('delivers frames in order, updates the cursor and ignores malformed frames', async () => {
    const t = setup();
    t.stream.start();
    await flush();
    last().open();
    const ws = last();
    expect(() => {
      ws.message('not json');
      ws.message(JSON.stringify({ data: { kind: 'x' } }));
      ws.message(JSON.stringify({ id: 'foo_1', data: { kind: 'x' } }));
      ws.message(JSON.stringify({ id: 'evt_9', data: {} }));
      ws.message(JSON.stringify(null));
      ws.message(42);
    }).not.toThrow();
    ws.message(JSON.stringify(evt('evt_1')));
    ws.message(JSON.stringify(evt('evt_2')));
    expect(t.events.map((e) => e.id)).toEqual(['evt_1', 'evt_2']);
    ws.serverClose(1006);
    await vi.advanceTimersByTimeAsync(1000);
    expect(new URL(last().url).searchParams.get('cursor')).toBe('evt_2');
    t.stream.stop();
  });

  it('polls and reconnects after 1 s with a new ticket, a different key and the cursor', async () => {
    const t = setup();
    t.stream.start();
    await flush();
    last().open();
    last().message(JSON.stringify(evt('evt_1')));
    last().serverClose(1006);
    await flush();
    expect(t.statuses.at(-1)).toBe('polling');
    expect(t.listEvents).toHaveBeenCalled();
    expect(t.createSocketTicket).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(t.createSocketTicket).toHaveBeenCalledTimes(2);
    expect(t.createSocketTicket.mock.calls[1][1]).not.toBe(t.createSocketTicket.mock.calls[0][1]);
    const url = new URL(last().url);
    expect(url.searchParams.get('cursor')).toBe('evt_1');
    expect(url.searchParams.get('ticket')).toBe('tkt_secret2');
    t.stream.stop();
  });

  it('backs off 1, 2, 4, 8, 16, 30, 30 s and resets after a successful open', async () => {
    const t = setup();
    t.createSocketTicket.mockRejectedValue(new C1Error(500));
    t.stream.start();
    await flush();
    let calls = 1;
    for (const seconds of [1, 2, 4, 8, 16, 30, 30]) {
      await vi.advanceTimersByTimeAsync(seconds * 1000 - 1);
      expect(t.createSocketTicket).toHaveBeenCalledTimes(calls);
      await vi.advanceTimersByTimeAsync(1);
      calls++;
      expect(t.createSocketTicket).toHaveBeenCalledTimes(calls);
    }
    t.createSocketTicket.mockResolvedValue({ ticket: 'tkt_ok', expiresAt: '', url: 'ws://127.0.0.1:1/s?ticket=tkt_ok' });
    await vi.advanceTimersByTimeAsync(30_000);
    last().open();
    last().serverClose(1006);
    await vi.advanceTimersByTimeAsync(999);
    const before = t.createSocketTicket.mock.calls.length;
    await vi.advanceTimersByTimeAsync(1);
    expect(t.createSocketTicket).toHaveBeenCalledTimes(before + 1);
    t.stream.stop();
  });

  it('honours Retry-After on 429 when larger than the backoff', async () => {
    const t = setup();
    t.createSocketTicket.mockRejectedValueOnce(new C1Error(429, undefined, 10));
    t.stream.start();
    await flush();
    await vi.advanceTimersByTimeAsync(9999);
    expect(t.createSocketTicket).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(t.createSocketTicket).toHaveBeenCalledTimes(2);
    t.stream.stop();
  });

  it('resets the cursor and reconnects at once on REPLAY_EXPIRED', async () => {
    const t = setup();
    t.stream.start();
    await flush();
    last().open();
    last().message(JSON.stringify(evt('evt_1')));
    last().serverClose(1008, 'REPLAY_EXPIRED');
    await flush();
    expect(t.onReplayExpired).toHaveBeenCalledTimes(1);
    expect(t.createSocketTicket).toHaveBeenCalledTimes(2);
    expect(last().url).not.toContain('cursor=');
    t.stream.stop();
  });

  it('stops polling when the socket opens', async () => {
    const t = setup();
    t.stream.start();
    await flush();
    last().serverClose(1006);
    await flush();
    await vi.advanceTimersByTimeAsync(1000);
    last().open();
    const calls = t.listEvents.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(t.listEvents).toHaveBeenCalledTimes(calls);
    t.stream.stop();
  });

  it('discards a poll response when the cursor changed meanwhile', async () => {
    let resolve!: (page: unknown) => void;
    const listEvents = vi.fn(() => new Promise((r) => (resolve = r)));
    const t = setup({ listEvents });
    t.stream.start();
    await flush();
    last().serverClose(1006);
    await flush();
    expect(listEvents).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    last().open();
    last().message(JSON.stringify(evt('evt_5')));
    resolve({ items: [evt('evt_1')], nextCursor: 'evt_1' });
    await flush();
    expect(t.events.map((e) => e.id)).toEqual(['evt_5']);
    t.stream.stop();
  });

  it('treats a non-ws URL as a failed attempt', async () => {
    const t = setup();
    t.createSocketTicket.mockResolvedValueOnce({ ticket: 't', expiresAt: '', url: 'https://example.test/s?ticket=t' });
    t.stream.start();
    await flush();
    expect(FakeWebSocket.instances).toHaveLength(0);
    expect(t.statuses.at(-1)).toBe('polling');
    t.stream.stop();
  });

  it('does not request tickets while offline and reconnects on the online event', async () => {
    let online = false;
    const t = setup({ online: () => online });
    t.stream.start();
    await vi.advanceTimersByTimeAsync(5000);
    expect(t.createSocketTicket).not.toHaveBeenCalled();
    expect(t.listEvents).not.toHaveBeenCalled();
    expect(t.statuses).toEqual(['offline']);
    online = true;
    window.dispatchEvent(new Event('online'));
    await flush();
    expect(t.createSocketTicket).toHaveBeenCalledTimes(1);
    last().open();
    expect(t.statuses.at(-1)).toBe('live');
    window.dispatchEvent(new Event('offline'));
    expect(t.statuses.at(-1)).toBe('offline');
    expect(last().closedWith?.code).toBe(1000);
    t.stream.stop();
  });

  it('stop() closes the socket, clears timers and silences callbacks', async () => {
    const t = setup();
    t.stream.start();
    await flush();
    const ws = last();
    ws.open();
    t.stream.stop();
    t.stream.stop();
    expect(ws.closedWith?.code).toBe(1000);
    const count = t.statuses.length;
    ws.message(JSON.stringify(evt('evt_1')));
    ws.serverClose(1006);
    window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(t.events).toHaveLength(0);
    expect(t.statuses).toHaveLength(count);
    expect(t.createSocketTicket).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stop() during polling leaves no timer pending', async () => {
    const t = setup();
    t.stream.start();
    await flush();
    last().serverClose(1006);
    await vi.advanceTimersByTimeAsync(500);
    t.stream.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('never logs the ticket or the URL', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m));
    const t = setup();
    t.stream.start();
    await flush();
    last().message('garbage');
    last().serverClose(1006);
    await vi.advanceTimersByTimeAsync(5000);
    t.stream.stop();
    for (const spy of spies) {
      expect(JSON.stringify(spy.mock.calls)).not.toMatch(/tkt_secret|ws:\/\//);
    }
  });
});
