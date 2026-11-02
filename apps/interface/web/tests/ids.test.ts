import { describe, expect, it } from 'vitest';
import { newId } from '@/lib/ids';

describe('newId', () => {
  it('matches the contract pattern', () => {
    expect(newId('msg')).toMatch(/^msg_[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it('is unique over 1000 ids', () => {
    expect(new Set(Array.from({ length: 1000 }, () => newId('msg'))).size).toBe(1000);
  });

  it('has a monotone time prefix', async () => {
    const first = newId('msg').slice(4, 14);
    await new Promise((r) => setTimeout(r, 5));
    const second = newId('msg').slice(4, 14);
    expect(second > first).toBe(true);
  });
});
