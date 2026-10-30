import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import type { Response } from 'express';
import type { ProblemCode, Problem } from '../contracts/types.js';
import { traceIdOf } from './trace.js';
import { loggerFor, line } from './log.js';
import { describeError } from './errors.js';

const TITLES: Record<string, string> = {
  INVALID_REQUEST: 'Requête invalide',
  UNAUTHORIZED: 'Authentification requise',
  FORBIDDEN: 'Accès refusé',
  NOT_FOUND: 'Ressource introuvable',
  IDEMPOTENCY_CONFLICT: 'Conflit d’idempotence',
  UNSUPPORTED_MEDIA_TYPE: 'Type de contenu non pris en charge',
  FILE_TOO_LARGE: 'Contenu trop volumineux',
  RATE_LIMITED: 'Trop de requêtes',
  UPSTREAM_UNAVAILABLE: 'Service indisponible',
};

const CODE_BY_STATUS: Record<number, ProblemCode> = {
  400: 'INVALID_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'IDEMPOTENCY_CONFLICT',
  413: 'FILE_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  429: 'RATE_LIMITED',
};

export class ProblemException extends HttpException {
  constructor(
    readonly httpStatus: number,
    readonly code: ProblemCode,
    readonly detail: string,
  ) {
    super(detail, httpStatus);
  }
}

export function buildProblem(status: number, code: string, detail: string, traceparent: unknown): Problem {
  return {
    type: 'about:blank',
    title: TITLES[code] ?? 'Erreur',
    status,
    detail,
    code,
    traceId: traceIdOf(traceparent),
  };
}

/** Écrit un `application/problem+json` directement (utilisable hors filtre Nest, ex. middleware). */
export function sendProblem(
  res: Pick<Response, 'status' | 'type' | 'send'>,
  status: number,
  code: ProblemCode,
  detail: string,
  traceparent: unknown,
): void {
  res.status(status);
  res.type('application/problem+json');
  res.send(JSON.stringify(buildProblem(status, code, detail, traceparent)));
}

@Catch()
export class ProblemFilter implements ExceptionFilter {
  private readonly logger = loggerFor('Http');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<{ headers: Record<string, unknown> }>();
    const res = http.getResponse<Response>();
    if (exception instanceof ProblemException) {
      sendProblem(res, exception.httpStatus, exception.code, exception.detail, req.headers['traceparent']);
      return;
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code = CODE_BY_STATUS[status] ?? 'INVALID_REQUEST';
      sendProblem(res, status, code, status === 404 ? 'Route inconnue' : 'Requête refusée', req.headers['traceparent']);
      return;
    }
    this.logger.error(line('http.unhandled', { error: describeError(exception) }));
    sendProblem(res, 500, 'UPSTREAM_UNAVAILABLE', 'Erreur interne', req.headers['traceparent']);
  }
}
