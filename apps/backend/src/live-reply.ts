import type { Conversations } from "./conversations.js";
import { TextDeltaExtractor } from "./text-deltas.js";

/** Visible text is written at most this often; the first piece goes out at once. */
export const DELTA_FLUSH_MS = 40;
/** Size of one stored message.delta (conversations.appendDelta splits above this). */
const DELTA_PART_CHARS = 8000;

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
 * Write failures never fail the reply (the final message carries the whole text anyway); unwritten text stays buffered.
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
    let unknown = false;
    if (!this.checked) {
      try {
        const existing = await this.conversations.pool.query(
          "SELECT 1 FROM backend_conversation_events WHERE conversation_id=$1 AND body->'data'->>'kind'='message.delta' AND body->'data'->>'messageId'=$2 LIMIT 1",
          [this.conversationId, this.messageId],
        );
        this.checked = true;
        if (existing.rows.length) this.started = true;
      } catch {
        // Database down: stay silent for this generation (a second draft is worse than none); asked again next time.
        unknown = true;
      }
    }
    const mine = !this.started && !unknown;
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
    this.lastFlush = Date.now();
    this.tail = this.tail.then(() => this.write());
  }

  /**
   * Writes the buffer one stored event at a time. A part leaves the buffer only once it is committed, so a failed
   * write keeps the text (retried at the next flush, same index: nothing doubled, nothing skipped) and never throws.
   */
  private async write(): Promise<void> {
    // Only what is buffered now: text arriving during the writes waits for the next flush window.
    let remaining = this.pending.length;
    while (remaining > 0) {
      const part = this.pending.slice(0, Math.min(remaining, DELTA_PART_CHARS));
      try {
        this.index += await this.conversations.appendDelta(this.conversationId, this.messageId, part, this.index, this.traceparent);
        this.pending = this.pending.slice(part.length);
        remaining -= part.length;
      } catch (error) {
        console.error("message.delta non écrit (réessai au prochain envoi) :", error instanceof Error ? error.message : "erreur inconnue");
        return;
      }
    }
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
