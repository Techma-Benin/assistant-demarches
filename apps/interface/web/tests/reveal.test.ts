import { describe, expect, it } from 'vitest';
import type { components } from '@techma/contracts-ts';
import { revealDelays, textRevealDuration, wordDelay } from '@/lib/reveal';

type Block = components['schemas']['Block'];
const text = (t: string): Block => ({ type: 'text', text: t, sources: [] });
const buttons: Block = { type: 'buttons', items: [{ id: 'a', label: 'A' }] };

describe('reveal timing', () => {
  it('uses 18 ms per word for short texts and caps the total at 600 ms', () => {
    expect(wordDelay(10)).toBe(18);
    expect(wordDelay(100)).toBe(6);
    expect(textRevealDuration('un deux trois')).toBe(54);
    expect(textRevealDuration(Array(200).fill('mot').join(' '))).toBe(600);
  });

  it('reveals very long texts per paragraph', () => {
    expect(textRevealDuration(Array(500).fill('mot').join(' '))).toBe(300);
  });

  it('starts block i at i*70 ms, after the text revealed before it', () => {
    expect(revealDelays([buttons, buttons, buttons])).toEqual([0, 70, 140]);
    expect(revealDelays([text('un deux trois'), buttons])).toEqual([0, 54 + 70]);
  });
});
