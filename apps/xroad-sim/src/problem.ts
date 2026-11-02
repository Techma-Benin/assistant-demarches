export type ProblemCode =
  | 'INVALID_REQUEST'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'IDEMPOTENCY_CONFLICT'
  | 'REQUEST_INCOMPLETE'
  | 'INVALID_TRANSITION'
  | 'NOT_ASSISTED'
  | 'UPSTREAM_UNAVAILABLE'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'FILE_TOO_LARGE';

export class ProblemError extends Error {
  constructor(
    readonly status: number,
    readonly code: ProblemCode,
    detail: string,
  ) {
    super(detail);
  }
}

export const notFound = (detail: string) => new ProblemError(404, 'NOT_FOUND', detail);
export const forbidden = (detail: string) => new ProblemError(403, 'FORBIDDEN', detail);
export const invalid = (detail: string) => new ProblemError(400, 'INVALID_REQUEST', detail);
export const invalidTransition = (detail: string) => new ProblemError(409, 'INVALID_TRANSITION', detail);
