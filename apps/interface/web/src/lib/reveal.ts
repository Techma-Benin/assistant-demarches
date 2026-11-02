import type { components } from '@techma/contracts-ts';

type Block = components['schemas']['Block'];

/** Delay between two blocks of the same answer. */
export const BLOCK_STEP_MS = 70;
/** A whole text reveals within this duration, whatever its length. */
export const TEXT_REVEAL_MS = 600;
/** Reveal speed of a short text, per word. */
export const WORD_STEP_MS = 18;
/** Above this many words the reveal is per paragraph (keeps the DOM light). */
export const MAX_WORD_REVEAL = 400;
/** Duration used for the paragraph-by-paragraph reveal of very long texts. */
export const PARAGRAPH_REVEAL_MS = 300;

export function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** Per-word delay so that the whole text stays within `TEXT_REVEAL_MS`. */
export function wordDelay(words: number): number {
  return Math.min(WORD_STEP_MS, TEXT_REVEAL_MS / Math.max(words, 1));
}

/** How long a text block takes to reveal (its marks and sources come right after). */
export function textRevealDuration(text: string): number {
  const words = wordCount(text);
  return words > MAX_WORD_REVEAL ? PARAGRAPH_REVEAL_MS : Math.round(words * wordDelay(words));
}

/** Start delay (ms) of every block of an answer: block i at i*70 ms, pushed back by the text revealed before it. */
export function revealDelays(blocks: readonly Block[]): number[] {
  const delays: number[] = [];
  let next = 0;
  for (const block of blocks) {
    delays.push(next);
    next += BLOCK_STEP_MS + (block.type === 'text' ? textRevealDuration(block.text) : 0);
  }
  return delays;
}
