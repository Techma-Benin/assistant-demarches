import { C1Error, type C1Client, type ConversationEvent } from './c1-client';

export type StreamStatus = 'connecting' | 'live' | 'polling' | 'offline';

const BACKOFF_SECONDS = [1, 2, 4, 8, 16, 30];
const POLL_INTERVAL_MS = 1000;
const PAGE_SIZE = 100;

export interface ConversationStreamDeps {
  client: Pick<C1Client, 'createSocketTicket' | 'listEvents'>;
  conversationId: string;
  onEvents(items: ConversationEvent[]): void;
  onReplayExpired(): void;
  onStatus(status: StreamStatus): void;
  /** Permanent failure (401/403/404): the stream has stopped and will not retry. */
  onFatal(status: number): void;
  WebSocketImpl?: typeof WebSocket;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
  newKey?: () => string;
  isOnline?: () => boolean;
}

// Session expired, access denied or conversation gone: retrying cannot succeed.
const isFatal = (error: unknown): error is C1Error =>
  error instanceof C1Error && (error.status === 401 || error.status === 403 || error.status === 404);

function isContractEvent(value: unknown): value is ConversationEvent {
  if (typeof value !== 'object' || value === null) return false;
  const { id, data } = value as { id?: unknown; data?: unknown };
  if (typeof id !== 'string' || !id.startsWith('evt_')) return false;
  return typeof data === 'object' && data !== null && typeof (data as { kind?: unknown }).kind === 'string';
}

// Realtime transport (CONTRACTS.md §5): WebSocket via single-use ticket + replay cursor, polling while
// there is no socket. Delivery is at-least-once; the consumer dedupes by Event.id.
export class ConversationStream {
  private cursor: string | null = null;
  private status: StreamStatus | null = null;
  private socket: WebSocket | null = null;
  private attempt = 0;
  private attemptId = 0;
  private stopped = true;
  private reconnectTimer: unknown = null;
  private pollTimer: unknown = null;
  private pollWake: (() => void) | null = null;
  private pollAbort: AbortController | null = null;

  private readonly setT: (fn: () => void, ms: number) => unknown;
  private readonly clearT: (handle: unknown) => void;
  private readonly newKey: () => string;
  private readonly isOnline: () => boolean;
  private readonly WebSocketImpl: typeof WebSocket | undefined;

  private readonly handleOnline = () => this.reconnectNow();
  private readonly handleOffline = () => {
    if (!this.stopped) this.goOffline();
  };

  constructor(private readonly deps: ConversationStreamDeps) {
    this.setT = deps.setTimeout ?? ((fn, ms) => globalThis.setTimeout(fn, ms));
    this.clearT = deps.clearTimeout ?? ((handle) => globalThis.clearTimeout(handle as never));
    this.newKey = deps.newKey ?? (() => crypto.randomUUID());
    this.isOnline =
      deps.isOnline ?? (() => (typeof navigator !== 'undefined' && 'onLine' in navigator ? navigator.onLine : true));
    this.WebSocketImpl = deps.WebSocketImpl;
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.handleOnline);
      window.addEventListener('offline', this.handleOffline);
    }
    this.connect();
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.attemptId++;
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.handleOnline);
      window.removeEventListener('offline', this.handleOffline);
    }
    this.clearReconnect();
    this.stopPolling();
    this.closeSocket();
  }

  reconnectNow(): void {
    if (this.stopped || this.status === 'live') return;
    this.attempt = 0;
    this.attemptId++;
    this.clearReconnect();
    this.closeSocket();
    this.connect();
  }

  private setStatus(status: StreamStatus): void {
    if (this.stopped || this.status === status) return;
    this.status = status;
    this.deps.onStatus(status);
  }

  private clearReconnect(): void {
    if (this.reconnectTimer !== null) this.clearT(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  // Detaches first so the close event of the old socket is ignored.
  private closeSocket(): void {
    const socket = this.socket;
    this.socket = null;
    if (!socket) return;
    try {
      socket.close(1000);
    } catch {
      // Already closed.
    }
  }

  private goOffline(): void {
    this.attemptId++;
    this.clearReconnect();
    this.stopPolling();
    this.closeSocket();
    this.setStatus('offline');
  }

  private connect(): void {
    if (this.stopped) return;
    this.clearReconnect();
    if (!this.isOnline()) {
      this.goOffline();
      return;
    }
    // While polling after a failure the status stays "polling" until the socket opens.
    if (this.status !== 'polling') this.setStatus('connecting');
    void this.openSocket();
  }

  private async openSocket(): Promise<void> {
    const id = ++this.attemptId;
    const stale = () => this.stopped || id !== this.attemptId;
    let url: URL;
    try {
      const ticket = await this.deps.client.createSocketTicket(this.deps.conversationId, this.newKey());
      if (stale()) return;
      url = new URL(ticket.url);
      if (url.protocol !== 'ws:' && url.protocol !== 'wss:') throw new Error('Unsupported socket protocol');
    } catch (error) {
      if (!stale()) this.fail(error);
      return;
    }
    if (this.cursor) url.searchParams.set('cursor', this.cursor);
    const Impl = this.WebSocketImpl ?? globalThis.WebSocket;
    let socket: WebSocket;
    try {
      socket = new Impl(url.toString());
    } catch (error) {
      this.fail(error);
      return;
    }
    this.socket = socket;
    socket.addEventListener('open', () => {
      if (this.socket !== socket || this.stopped) return;
      this.attempt = 0;
      this.stopPolling();
      this.setStatus('live');
    });
    socket.addEventListener('message', (message) => {
      if (this.socket !== socket || this.stopped) return;
      this.handleFrame(message.data);
    });
    socket.addEventListener('close', (close) => {
      if (this.socket !== socket || this.stopped) return;
      this.socket = null;
      if (close.code === 1008 && close.reason === 'REPLAY_EXPIRED') {
        this.cursor = null;
        this.deps.onReplayExpired();
        this.connect();
        return;
      }
      this.fail();
    });
  }

  private handleFrame(raw: unknown): void {
    if (typeof raw !== 'string') return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    if (!isContractEvent(parsed)) return;
    this.cursor = parsed.id;
    this.deps.onEvents([parsed]);
  }

  // Failed attempt (ticket, URL, socket): poll meanwhile and retry with backoff.
  private fail(error?: unknown): void {
    if (this.stopped) return;
    if (isFatal(error)) {
      this.fatal(error.status);
      return;
    }
    this.closeSocket();
    if (!this.isOnline()) {
      this.goOffline();
      return;
    }
    this.setStatus('polling');
    this.startPolling();
    let delay = BACKOFF_SECONDS[Math.min(this.attempt, BACKOFF_SECONDS.length - 1)] * 1000;
    this.attempt++;
    if (error instanceof C1Error && (error.status === 429 || error.status === 503)) {
      delay = Math.max((error.retryAfterSeconds ?? 0) * 1000, delay);
    }
    this.clearReconnect();
    this.reconnectTimer = this.setT(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private fatal(status: number): void {
    this.stop();
    this.deps.onFatal(status);
  }

  private startPolling(): void {
    if (this.pollAbort) return;
    const controller = new AbortController();
    this.pollAbort = controller;
    void this.pollLoop(controller.signal);
  }

  private stopPolling(): void {
    this.pollAbort?.abort();
    this.pollAbort = null;
    if (this.pollTimer !== null) this.clearT(this.pollTimer);
    this.pollTimer = null;
    this.pollWake?.();
    this.pollWake = null;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      this.pollWake = resolve;
      this.pollTimer = this.setT(() => {
        this.pollTimer = null;
        this.pollWake = null;
        resolve();
      }, ms);
    });
  }

  // Same semantics as the former hook loop: 100-item pages poll again at once, 410 resets the cursor,
  // 429/503 wait Retry-After.
  private async pollLoop(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      const requestCursor = this.cursor;
      let delay = POLL_INTERVAL_MS;
      try {
        const page = await this.deps.client.listEvents(this.deps.conversationId, requestCursor, signal);
        if (signal.aborted) return;
        // The socket (or an earlier page) moved the cursor meanwhile: discard, the replay covers it.
        if (this.cursor === requestCursor) {
          if (page.items.length > 0) {
            this.cursor = page.items[page.items.length - 1].id;
            this.deps.onEvents(page.items);
          }
          if (page.items.length === PAGE_SIZE) delay = 0;
        }
      } catch (error) {
        if (signal.aborted) return;
        if (isFatal(error)) {
          this.fatal(error.status);
          return;
        }
        if (error instanceof C1Error && error.status === 410) {
          if (this.cursor === requestCursor) {
            this.cursor = null;
            this.deps.onReplayExpired();
          }
          delay = 0;
        } else if (error instanceof C1Error && (error.status === 429 || error.status === 503)) {
          delay = (error.retryAfterSeconds ?? 1) * 1000;
        }
      }
      if (signal.aborted) return;
      if (delay > 0) await this.sleep(delay);
    }
  }
}
