// Only the error type is kept: the console (admin) still imports it. The operator screen uses `@/lib/operator/api`.
export interface Problem {
  type?: string;
  title?: string;
  status?: number;
  detail?: string;
  code?: string;
  traceId?: string;
}

export class C3Error extends Error {
  readonly status: number;
  readonly problem?: Problem;

  constructor(status: number, problem?: Problem) {
    super(problem?.detail ?? `Erreur C3 (HTTP ${status})`);
    this.name = 'C3Error';
    this.status = status;
    this.problem = problem;
  }
}
