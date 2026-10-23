import { randomBytes } from 'node:crypto';
import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { ProblemError } from './problem.js';

export interface TraceContext {
  traceparent: string;
  traceId: string;
  parentId: string;
}

const TRACEPARENT = /^00-([a-f0-9]{32})-([a-f0-9]{16})-0[01]$/;
const ZERO_TRACE = '0'.repeat(32);
const ZERO_SPAN = '0'.repeat(16);

/** Analyse un en-tête W3C traceparent v00 ; refuse trace ou span entièrement nuls. */
export function parseTraceparent(value: unknown): TraceContext | undefined {
  if (typeof value !== 'string') return undefined;
  const match = TRACEPARENT.exec(value);
  if (!match || match[1] === ZERO_TRACE || match[2] === ZERO_SPAN) return undefined;
  return { traceparent: value, traceId: match[1], parentId: match[2] };
}

export function traceOf(req: Request): TraceContext {
  const trace = parseTraceparent(req.headers.traceparent);
  if (!trace) throw new ProblemError(400, 'INVALID_REQUEST', 'traceparent W3C v00 requis');
  return trace;
}

/** traceparent d'un appel sortant : même trace, nouveau span. */
export function childTraceparent(trace: Pick<TraceContext, 'traceId'>): string {
  return `00-${trace.traceId}-${randomBytes(8).toString('hex')}-01`;
}

/** Identifiant de trace pour les erreurs, y compris quand l'en-tête est invalide. */
export function traceIdOf(req: Request): string {
  return parseTraceparent(req.headers.traceparent)?.traceId ?? ZERO_TRACE;
}

/** Exige traceparent sur toute route, sauf la sonde de santé (exclue à l'enregistrement). */
@Injectable()
export class TraceMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction): void {
    traceOf(req);
    next();
  }
}
