import { createHmac, timingSafeEqual } from 'node:crypto';

const HEADER = /^sha256=([0-9a-fA-F]{64})$/;

/** Vérifie `X-Hub-Signature-256` sur les octets bruts, à temps constant. */
export function verifyMetaSignature(appSecret: string, rawBody: Buffer, header: unknown): boolean {
  if (typeof header !== 'string') return false;
  const match = HEADER.exec(header);
  if (!match) return false;
  const expected = createHmac('sha256', appSecret).update(rawBody).digest();
  const received = Buffer.from(match[1]!, 'hex');
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export const signBody = (appSecret: string, rawBody: Buffer | string): string =>
  `sha256=${createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
