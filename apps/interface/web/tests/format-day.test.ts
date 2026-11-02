import { describe, expect, it } from 'vitest';
import { dayKey, formatDayLabel } from '@/lib/format-time';

const now = new Date(2026, 10, 3, 15, 0); // Tuesday 3 November 2026, local
const local = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).toISOString();

describe('formatDayLabel', () => {
  it('says today and yesterday', () => {
    expect(formatDayLabel(local(2026, 11, 3, 8), now)).toBe('Aujourd’hui');
    expect(formatDayLabel(local(2026, 11, 2, 23), now)).toBe('Hier');
  });
  it('spells older days, with the year only when it is not the current one', () => {
    expect(formatDayLabel(local(2026, 11, 1), now)).toBe('dimanche 1 novembre');
    expect(formatDayLabel(local(2025, 12, 25), now)).toBe('jeudi 25 décembre 2025');
  });
  it('is empty for an invalid date', () => {
    expect(formatDayLabel('nope', now)).toBe('');
    expect(dayKey('nope')).toBe('');
  });
});
