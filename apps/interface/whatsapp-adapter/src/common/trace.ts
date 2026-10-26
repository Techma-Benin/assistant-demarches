import { randomBytes } from 'node:crypto';

export const ZERO_TRACE_ID = '0'.repeat(32);
const TRACEPARENT = /^00-([a-f0-9]{32})-([a-f0-9]{16})-0[01]$/;

export interface ParsedTraceparent {
  traceId: string;
  spanId: string;
}

/** Retourne null si le format v00 est invalide ou si la trace ou le span est entièrement nul. */
export function parseTraceparent(value: unknown): ParsedTraceparent | null {
  if (typeof value !== 'string') return null;
  const match = TRACEPARENT.exec(value);
  if (!match) return null;
  const [, traceId, spanId] = match as unknown as [string, string, string];
  if (/^0+$/.test(traceId) || /^0+$/.test(spanId)) return null;
  return { traceId, spanId };
}

export function newTraceparent(): string {
  let traceId = '';
  let spanId = '';
  do traceId = randomBytes(16).toString('hex');
  while (/^0+$/.test(traceId));
  do spanId = randomBytes(8).toString('hex');
  while (/^0+$/.test(spanId));
  return `00-${traceId}-${spanId}-01`;
}

export const traceIdOf = (traceparent: unknown): string => parseTraceparent(traceparent)?.traceId ?? ZERO_TRACE_ID;
