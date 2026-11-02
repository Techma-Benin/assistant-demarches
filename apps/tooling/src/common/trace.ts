import { randomBytes } from 'node:crypto';
import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

export interface TraceContext {
  traceparent: string;
  traceId: string;
  parentId: string;
}

const TRACEPARENT = /^00-([a-f0-9]{32})-([a-f0-9]{16})-0[01]$/;
const ZERO_TRACE = '0'.repeat(32);
const ZERO_SPAN = '0'.repeat(16);

export function parseTraceparent(value: unknown): TraceContext | undefined {
  if (typeof value !== 'string') return undefined;
  const match = TRACEPARENT.exec(value);
  if (!match || match[1] === ZERO_TRACE || match[2] === ZERO_SPAN) return undefined;
  return { traceparent: value, traceId: match[1], parentId: match[2] };
}

export function newTrace(): TraceContext {
  const traceId = randomBytes(16).toString('hex');
  const parentId = randomBytes(8).toString('hex');
  return { traceparent: `00-${traceId}-${parentId}-01`, traceId, parentId };
}

export function traceOf(req: Request): TraceContext {
  const trace = parseTraceparent(req.headers.traceparent);
  if (trace) return trace;
  const created = newTrace();
  req.headers.traceparent = created.traceparent;
  return created;
}

export function childTraceparent(trace: Pick<TraceContext, 'traceId'>): string {
  return `00-${trace.traceId}-${randomBytes(8).toString('hex')}-01`;
}

export function traceIdOf(req: Request): string {
  return parseTraceparent(req.headers.traceparent)?.traceId ?? ZERO_TRACE;
}

@Injectable()
export class TraceMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction): void {
    traceOf(req);
    next();
  }
}
