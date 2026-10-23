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

/** Erreur métier ou de transport, rendue en application/problem+json. */
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

@Catch()
export class ProblemFilter implements ExceptionFilter {
  private readonly logger = new Logger('Problem');

  catch(error: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    let status = 500;
    let code: ProblemCode = 'INVALID_REQUEST';
    let detail = 'Erreur interne';

    if (error instanceof ProblemError) {
      ({ status, code } = error);
      detail = error.message;
    } else if (error instanceof HttpException) {
      status = error.getStatus();
      code = CODE_BY_STATUS[status] ?? 'INVALID_REQUEST';
      detail = status === 404 ? 'Route inconnue' : 'Requête refusée';
    } else {
      // Ni pile ni message interne dans la réponse ; seulement dans le journal serveur.
      this.logger.error(error instanceof Error ? error.stack : String(error));
    }

    res
      .status(status)
      .type('application/problem+json')
      .send(JSON.stringify({ type: 'about:blank', title: code, status, detail, code, traceId: traceIdOf(req) }));
  }
}
