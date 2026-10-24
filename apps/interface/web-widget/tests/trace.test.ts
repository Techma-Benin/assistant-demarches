import { describe, expect, it } from 'vitest';
import { newTraceparent } from '@/lib/trace';

describe('newTraceparent', () => {
  it('has the W3C v00 format', () => {
    for (let i = 0; i < 50; i++) expect(newTraceparent()).toMatch(/^00-[a-f0-9]{32}-[a-f0-9]{16}-01$/);
  });

  it('is never all zeros', () => {
    const [, trace, span] = newTraceparent().split('-');
    expect(trace).not.toMatch(/^0+$/);
    expect(span).not.toMatch(/^0+$/);
  });
});
