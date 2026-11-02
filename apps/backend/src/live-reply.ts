import type { Conversations } from "./conversations.js";
import { TextDeltaExtractor } from "./text-deltas.js";

/** Visible text is written at most this often; the first piece goes out at once. */
export const DELTA_FLUSH_MS = 40;

export type LiveAttempt = {
  onTextDelta(delta: string): void;
  onToolCall(): void;
};

/**
 * Live `message.delta` of one assistant reply (CONTRACTS.md §7.1), written while the model is still generating.
 *
 * Rules, all chosen so that `message.sent` can always replace what was shown:
 * - only the JSON string values of `"text"` keys of the model envelope are streamed (never buttons, forms, sources);
 * - a turn that starts a tool call is never streamed (text before the call in that chunk is dropped, later text too);
 * - one reply streams at most once: if a delta already exists for this messageId (retry of an invalid reply, an
 *   earlier turn, a replay after a crash) the next attempts stay silent, so the bubble is never fed two drafts;
 * - indexes are 0-based and strictly increasing; pieces are grouped within DELTA_FLUSH_MS;
 * - `settle()` waits for every write: callers settle before `message.sent` so no delta follows it.
 * Write failures never fail the reply: the final message carries the whole text anyway.
 */
export class LiveReply {
  private index = 0;
  private started = false;
  private checked = false;
  private pending = "";
  private lastFlush = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private tail: Promise<void> = Promise.resolve();
  private open = true;

  constructor(
    private conversations: Conversations,
    private conversationId: string,
    private messageId: string,
    private traceparent: string,
    private interval = DELTA_FLUSH_MS,
  ) {}

  /** Listener for one model generation. Silent when this reply already streamed (or was streamed before a restart). */
  async attempt(): Promise<LiveAttempt> {
    if (!this.checked) {
      this.checked = true;
      const existing = await this.conversations.pool.query(
        "SELECT 1 FROM backend_conversation_events WHERE conversation_id=$1 AND body->'data'->>'kind'='message.delta' AND body->'data'->>'messageId'=$2 LIMIT 1",
        [this.conversationId, this.messageId],
      );
      if (existing.rows.length) this.started = true;
    }
    const mine = !this.started;
    const extractor = new TextDeltaExtractor();
    let muted = !mine;
    return {
      onTextDelta: (delta) => {
        if (muted || !this.open || typeof delta !== "string" || !delta) return;
        const visible = extractor.push(delta);
        if (!visible) return;
        this.started = true;
        this.pending += visible;
        this.schedule();
      },
      onToolCall: () => { muted = true; },
    };
  }

  private schedule() {
    if (this.timer) return;
    const wait = Math.max(0, this.lastFlush + this.interval - Date.now());
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.flush();
    }, wait);
  }

  private flush() {
    if (!this.pending) return;
    const delta = this.pending;
    this.pending = "";
    this.lastFlush = Date.now();
    this.tail = this.tail.then(async () => {
      try {
        this.index += await this.conversations.appendDelta(this.conversationId, this.messageId, delta, this.index, this.traceparent);
      } catch (error) {
        console.error("message.delta non écrit :", error instanceof Error ? error.message : "erreur inconnue");
      }
    });
  }

  /** Writes what is buffered and waits until every delta is committed. */
  async settle(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    this.flush();
    await this.tail;
  }

  /** Settles, then ignores anything the model may still emit. */
  async close(): Promise<void> {
    await this.settle();
    this.open = false;
  }
}
