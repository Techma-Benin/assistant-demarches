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
  | 'REPLAY_EXPIRED';

/** Erreur métier ou de transport, rendue en application/problem+json ou en erreur d'outil MCP. */
export class ProblemError extends Error {
  constructor(
    readonly status: number,
    readonly code: ProblemCode,
    detail: string,
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

/**
 * Normalise toute erreur. Les erreurs inattendues sont journalisées côté serveur
 * et ne laissent sortir ni pile ni message interne.
 * Le contrat n'a pas de code pour une erreur interne : 500 + INVALID_REQUEST, comme les simulations.
 */
export function toProblem(error: unknown): { status: number; code: ProblemCode; detail: string } {
  if (error instanceof ProblemError) return { status: error.status, code: error.code, detail: error.message };
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
    const { status, code, detail } = toProblem(error);
    if (res.headersSent) return;
    if (status === 401) res.setHeader('WWW-Authenticate', 'Bearer');
    res
      .status(status)
      .type('application/problem+json')
      .send(JSON.stringify({ type: 'about:blank', title: code, status, detail, code, traceId: traceIdOf(req) }));
  }
}
