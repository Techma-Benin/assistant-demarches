import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const sha256Hex = (data: string | Uint8Array): string => createHash('sha256').update(data).digest('hex');

export const hmacSha256Hex = (key: string, data: string | Uint8Array): string =>
  createHmac('sha256', key).update(data).digest('hex');

/** Comparaison à temps constant, indépendante de la longueur (compare les empreintes). */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

/** Clé d’abonné : 12 premiers caractères hex de HMAC-SHA256(clé, wa_id). Jamais le numéro lui-même. */
export const subjectKeyFor = (hmacKey: string, waId: string): string => hmacSha256Hex(hmacKey, waId).slice(0, 12);

/** JSON canonique (clés triées) pour comparer des corps indépendamment de l’ordre des clés. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj)
      .sort()
      .filter((k) => obj[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
