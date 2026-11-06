import type { Conversations } from "./conversations.js";
import type { Schemas } from "./domain.js";
import { draftCitesOutside, hasStreamingAdminFact, hasTrailingEnvelope, looksLikeJsonEnvelope, stripForeignUrls } from "./model-reply.js";
import { redact } from "./model.js";
import { TextDeltaExtractor } from "./text-deltas.js";

/** Visible text is written at most this often; the first piece goes out at once. */
export const DELTA_FLUSH_MS = 40;
/** Size of one stored message.delta (conversations.appendDelta splits above this). */
const DELTA_PART_CHARS = 8000;

export type LiveAttempt = {
  onTextDelta(delta: string): void;
  onToolCall(): void;
  /** The generation returned `replyText`: releases the held-back tail when the stream carried all of it. */
  complete(replyText: unknown): void;
  /** Drop this attempt without publishing (format/source rejection). */
  reject(): void;
};

const KEYWORDS = ["npi", "otp", "code sms", "mot de passe"];
const URL_IN_JSON = /https?:\/\/[^\s"'\\<>]+/gi;
const WORD = /[A-Za-z0-9_]/;
const SENSITIVE_KEYWORD_WITH_VALUE = /\b(?:npi|otp|code\s*sms|mot de passe)\s*[:=]?\s*\S*$/i;

/**
 * Length of the part of `text` that redact() can no longer change: everything before the last incomplete word and
 * before any suffix that may still become an e-mail, a phone number or an "NPI/OTP/code SMS/mot de passe" value.
 */
export function stableEnd(text: string): number {
  // 1. The last word is incomplete until a separator follows (an e-mail never contains whitespace).
  let end = 0;
  for (let index = text.length - 1; index >= 0; index--)
    if (/\s/.test(text[index]!)) { end = index + 1; break; }
  // 2. Whatever is open at the edge of the stable part moves it back, until nothing is (a number may sit right
  //    after a keyword, a number may be cut between two of its groups).
  for (;;) {
    const continues = end === text.length || /[\d .()-]/.test(text[end]!);
    const next = Math.min(end, openSuffix(text.slice(0, end), continues));
    if (next === end) return end;
    end = next;
  }
}

/** Start of the suffix of `text` that a later character could still turn into a masked value (text.length if none). */
function openSuffix(text: string, numbers: boolean): number {
  let start = text.length;
  // A trailing run of digits and phone punctuation (spaces included) can still grow into a number when the next
  // character (`numbers`) continues it.
  let run = numbers ? text.length : 0;
  while (run > 0 && /[\d .()-]/.test(text[run - 1]!)) run--;
  for (let index = run; numbers && index < text.length; index++)
    if (/\d/.test(text[index]!)) {
      start = text[index - 1] === "+" ? index - 1 : index;
      break;
    }
  // A keyword whose value is not complete yet, or a keyword still being typed.
  const keyword = SENSITIVE_KEYWORD_WITH_VALUE.exec(text);
  if (keyword) start = Math.min(start, keyword.index);
  for (const word of KEYWORDS)
    for (let from = Math.max(0, text.length - word.length - 8); from < text.length; from++) {
      if (/\s/.test(text[from]!) || (from > 0 && WORD.test(text[from - 1]!))) continue;
      const tail = text.slice(from).toLowerCase();
      const comparable = word === "code sms" ? tail.replace(/\s+/g, "") : tail;
      if (comparable && (word === "code sms" ? "codesms" : word).startsWith(comparable)) start = Math.min(start, from);
    }
  return start;
}

/**
 * Live `message.delta` of one assistant reply (CONTRACTS.md §7.1), written while the model is still generating.
 *
 * Rules, all chosen so that `message.sent` can always replace what was shown:
 * - only the JSON string values of `"text"` keys of the model envelope are streamed (never buttons, forms, sources);
 * - a turn that starts a tool call is never streamed (text before the call in that chunk is dropped, later text too);
 * - free prose and drafts that cite unknown sources or administrative facts without an observed source stay buffered
 *   and are never written; only an attempt that can be accepted is flushed (or published after validation);
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
  /** Masked text already handed to the writer (a prefix of what the user sees). */
  private staged = "";
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
  async attempt(
    observedSources: readonly Pick<Schemas["Source"], "procedureId" | "url">[] = [],
    options: { hold?: boolean } = {},
  ): Promise<LiveAttempt> {
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
    let raw = "";
    let incoming = "";
    let fed = 0;
    // `hold`: the text will be discarded for a forced call; stay silent, publishVisible() speaks after acceptance.
    let muted = !mine || Boolean(options.hold);
    const observed = [...observedSources];
    const stage = (visible: string, final: boolean) => {
      // Only masked text leaves, and only the part no later character can turn into a sensitive value.
      const masked = redact(stripForeignUrls(final ? visible : visible.slice(0, stableEnd(visible)), observed));
      if (!masked.startsWith(this.staged) || masked.length === this.staged.length) return;
      this.pending += masked.slice(this.staged.length);
      this.staged = masked;
      this.started = true;
      this.schedule();
    };
    // Same order as presentModelReply: foreign URLs are removed before the text is judged.
    const cleanedFact = (text: string) => hasStreamingAdminFact(stripForeignUrls(text, observed));
    // Unknown PS ids anywhere, unknown URLs only outside the visible text (the text itself is cleaned by stage()).
    const citesOutsideText = () => {
      const inText = raw.match(URL_IN_JSON) ?? [];
      const outside = incoming.replace(URL_IN_JSON, (found) => inText.some((url) => found.startsWith(url) || url.startsWith(found)) ? "" : found);
      return draftCitesOutside(outside, observed);
    };
    const gated = () => {
      if (muted || !looksLikeJsonEnvelope(incoming)) return true;
      if (citesOutsideText()) {
        muted = true;
        return true;
      }
      return cleanedFact(raw) && observed.length === 0;
    };
    const ingest = (piece: string) => {
      const visible = extractor.push(piece);
      if (!visible) return;
      raw += visible;
      if (gated()) return;
      stage(raw, false);
    };
    return {
      onTextDelta: (delta) => {
        if (muted || !this.open || typeof delta !== "string" || !delta) return;
        incoming += delta;
        if (!looksLikeJsonEnvelope(incoming)) return;
        const fresh = incoming.slice(fed);
        fed = incoming.length;
        ingest(fresh);
      },
      onToolCall: () => { muted = true; },
      complete: (replyText) => {
        if (muted || !this.open || typeof replyText !== "string") return;
        if (!looksLikeJsonEnvelope(replyText)) {
          // The envelope is parsed later; agent.ts publishes the validated text through publishVisible.
          if (hasTrailingEnvelope(replyText)) {
            muted = true;
            return;
          }
          incoming = replyText;
          raw = replyText;
          if (!(cleanedFact(replyText) && observed.length === 0)) stage(raw, true);
          muted = true;
          return;
        }
        // The held tail is released only when the stream carried the whole reply (a broken stream retried elsewhere
        // may end in the middle of an e-mail).
        const whole = new TextDeltaExtractor().push(replyText);
        if (whole === raw && !gated()) stage(raw, true);
        muted = true;
      },
      reject: () => { muted = true; },
    };
  }

  /** After validation: publish accepted visible text when this attempt was held (plain text wrap, etc.). */
  publishVisible(text: string) {
    if (this.started || !this.open || !text) return;
    const masked = redact(text);
    if (!masked) return;
    this.pending += masked;
    this.staged = masked;
    this.started = true;
    this.schedule();
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
