const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Crockford ULID with a prefix: 10 chars of time (ms, base32) + 16 random chars. */
export function newId(prefix: 'msg'): string {
  let ms = Date.now();
  let time = '';
  for (let i = 0; i < 10; i++) {
    time = ALPHABET[ms % 32] + time;
    ms = Math.floor(ms / 32);
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let random = '';
  for (const byte of bytes) random += ALPHABET[byte % 32];
  return `${prefix}_${time}${random}`;
}
