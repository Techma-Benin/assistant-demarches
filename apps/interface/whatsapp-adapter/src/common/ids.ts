import { createHash } from 'node:crypto';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function timePart(ms: number): string {
  let out = '';
  let n = Math.max(0, Math.floor(ms));
  for (let i = 0; i < 10; i++) {
    out = CROCKFORD[n % 32]! + out;
    n = Math.floor(n / 32);
  }
  return out;
}

/** 16 caractères Crockford (80 bits) tirés de sha256(valeur). */
function hashPart(value: string): string {
  const digest = createHash('sha256').update(value).digest();
  let bits = 0n;
  for (let i = 0; i < 10; i++) bits = (bits << 8n) | BigInt(digest[i]!);
  let out = '';
  for (let i = 0; i < 16; i++) {
    out = CROCKFORD[Number(bits & 31n)]! + out;
    bits >>= 5n;
  }
  return out;
}

/**
 * Identifiant `MessageInput.id` déterministe depuis le wamid : une relivraison Meta donne le même id,
 * donc le Backend déduplique. Motif : ^msg_[0-9A-HJKMNP-TV-Z]{26}$.
 */
export function deriveMessageId(wamid: string, timestampSeconds: number): string {
  return `msg_${timePart(timestampSeconds * 1000)}${hashPart(wamid)}`;
}
