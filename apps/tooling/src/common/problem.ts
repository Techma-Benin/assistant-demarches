import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { traceIdOf } from './trace.js';

export type ProblemCode =
  | 'INVALID_REQUEST'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'IDEMPOTENCY_CONFLICT'
  | 'MANDATE_MISSING'
  | 'MANDATE_EXPIRED'
  | 'MANDATE_REVOKED'
  | 'MANDATE_SCOPE_DENIED'
  | 'REQUEST_INCOMPLETE'
  | 'INVALID_TRANSITION'
  | 'UPSTREAM_UNAVAILABLE'
  | 'RATE_LIMITED'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'FILE_TOO_LARGE'
  | 'REPLAY_EXPIRED'
  | 'LOGIN_REQUIRED'
  | 'CONFLICT'
  | 'NOT_ASSISTED';

export class ProblemError extends Error {
  constructor(
    readonly status: number,
    readonly code: ProblemCode,
    detail: string,
    readonly retryAfter?: number,
  ) {
    super(detail);
  }
}

const CODE_BY_STATUS: Record<number, ProblemCode> = {
  400: 'INVALID_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  413: 'FILE_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  429: 'RATE_LIMITED',
  503: 'UPSTREAM_UNAVAILABLE',
};

const logger = new Logger('Problem');
const DEFAULT_RETRY_AFTER = 5;

export function toProblem(error: unknown): { status: number; code: ProblemCode; detail: string; retryAfter?: number } {
  if (error instanceof ProblemError) {
    const retryAfter = error.retryAfter ?? (error.status === 429 || error.status === 503 ? DEFAULT_RETRY_AFTER : undefined);
    return { status: error.status, code: error.code, detail: error.message, retryAfter };
  }
  if (error instanceof HttpException) {
    const status = error.getStatus();
    return { status, code: CODE_BY_STATUS[status] ?? 'INVALID_REQUEST', detail: status === 404 ? 'Route inconnue' : 'Requête refusée' };
  }
  logger.error(error instanceof Error ? error.stack : String(error));
  return { status: 500, code: 'INVALID_REQUEST', detail: 'Erreur interne' };
}

@Catch()
export class ProblemFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const { status, code, detail, retryAfter } = toProblem(error);
    if (res.headersSent) return;
    if (status === 401) res.setHeader('WWW-Authenticate', 'Bearer');
    if (retryAfter !== undefined) res.setHeader('Retry-After', String(retryAfter));
    res
      .status(status)
      .type('application/problem+json')
      .send(JSON.stringify({ type: 'about:blank', title: code, status, detail, code, traceId: traceIdOf(req) }));
  }
}
