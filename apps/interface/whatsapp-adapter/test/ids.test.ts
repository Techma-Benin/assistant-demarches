import { describe, expect, it } from 'vitest';
import { deriveMessageId } from '../src/common/ids.js';

const PATTERN = /^msg_[0-9A-HJKMNP-TV-Z]{26}$/;

describe('deriveMessageId', () => {
  it('respecte le motif du contrat', () => {
    expect(deriveMessageId('wamid.ABC', 1760000000)).toMatch(PATTERN);
    expect(deriveMessageId('wamid.ÉÀ/+=', 0)).toMatch(PATTERN);
  });

  it('est déterministe pour un même wamid', () => {
    expect(deriveMessageId('wamid.ABC', 1760000000)).toBe(deriveMessageId('wamid.ABC', 1760000000));
  });

  it('diffère pour des wamid différents', () => {
    expect(deriveMessageId('wamid.A', 1760000000)).not.toBe(deriveMessageId('wamid.B', 1760000000));
  });
});
