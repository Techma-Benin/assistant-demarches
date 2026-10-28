import { createHash, randomBytes } from 'node:crypto';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function newId(prefix: 'req' | 'mdt' | 'evt'): string {
  let time = Date.now();
  let head = '';
  for (let n = 0; n < 10; n += 1) {
    head = CROCKFORD[time % 32] + head;
    time = Math.floor(time / 32);
  }
  const tail = Array.from(randomBytes(16), (byte) => CROCKFORD[byte % 32]).join('');
  return `${prefix}_${head}${tail}`;
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
