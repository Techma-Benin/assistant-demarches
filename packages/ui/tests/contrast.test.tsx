import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/styles/tokens.css'), 'utf8');

function parseBlock(selector: string): Record<string, string> {
  const start = css.indexOf(selector);
  if (start < 0) throw new Error(`Bloc introuvable : ${selector}`);
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
  const tokens: Record<string, string> = {};
  for (const match of body.matchAll(/--ui-([a-z-]+):\s*([^;]+);/g)) tokens[match[1]] = match[2].trim();
  return tokens;
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const pairs: [string, string, number][] = [
  ['text', 'canvas', 7],
  ['text-muted', 'canvas', 4.5],
  ['text-subtle', 'surface', 4.5],
  ['on-action', 'action', 4.5],
  ['trust-text', 'trust-soft', 4.5],
  ['on-trust', 'trust', 4.5],
  ['danger-text', 'danger-soft', 4.5],
  ['warning-text', 'warning-soft', 4.5],
  ['field-border', 'surface', 3],
];

describe.each([
  ['light', ":root,\n[data-theme='light'] {"],
  ['dark', "[data-theme='dark'] {"],
  ['dark (system)', ":root:not([data-theme='light']) {"],
])('contrast %s', (_name, selector) => {
  const tokens = parseBlock(selector);
  it.each(pairs)('%s on %s >= %s', (fg, bg, min) => {
    const [a, b] = [tokens[fg], tokens[bg]];
    if (!a.startsWith('#') || !b.startsWith('#')) return;
    expect(ratio(a, b)).toBeGreaterThanOrEqual(min);
  });
});

describe('themes', () => {
  it('system dark block mirrors the explicit dark block', () => {
    expect(parseBlock(":root:not([data-theme='light']) {")).toEqual(parseBlock("[data-theme='dark'] {"));
  });
});
