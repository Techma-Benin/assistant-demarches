import type { AdminPaths } from '@techma/contracts-ts';
import { newTraceparent } from '@/lib/trace';

type Ok<Op extends { responses: { 200: { content: { 'application/json': unknown } } } }> =
  Op['responses'][200]['content']['application/json'];

export type ModelPage = Ok<NonNullable<AdminPaths['/v1/admin/models']['get']>>;
export type ToolPage = Ok<NonNullable<AdminPaths['/v1/admin/tools']['get']>>;
export type ProcedurePage = Ok<NonNullable<AdminPaths['/v1/admin/procedures']['get']>>;
export type ConversationPage = Ok<NonNullable<AdminPaths['/v1/admin/conversations']['get']>>;
export type AuditPage = Ok<NonNullable<AdminPaths['/v1/admin/audit']['get']>>;
export type Metrics = Ok<NonNullable<AdminPaths['/v1/admin/metrics']['get']>>;

export type ModelConfig = ModelPage['items'][number];
export type ToolConfig = ToolPage['items'][number];
export type Procedure = ProcedurePage['items'][number];
export type AdminConversation = ConversationPage['items'][number];
export type AuditEntry = AuditPage['items'][number];

export interface Problem {
  type?: string;
  title?: string;
  status?: number;
  detail?: string;
  code?: string;
  traceId?: string;
}

export interface PageParams {
  cursor?: string | null;
  limit?: number;
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

export class C3Client {
  constructor(
    private readonly fetchImpl: typeof fetch = (...args) => fetch(...args),
    readonly basePath = '/api/admin',
  ) {}

  listModels(params: PageParams = {}, signal?: AbortSignal): Promise<ModelPage> {
    return this.list('models', params, signal);
  }

  listTools(params: PageParams = {}, signal?: AbortSignal): Promise<ToolPage> {
    return this.list('tools', params, signal);
  }

  listProcedures(params: PageParams = {}, signal?: AbortSignal): Promise<ProcedurePage> {
    return this.list('procedures', params, signal);
  }

  listConversations(params: PageParams = {}, signal?: AbortSignal): Promise<ConversationPage> {
    return this.list('conversations', params, signal);
  }

  listAudit(params: PageParams = {}, signal?: AbortSignal): Promise<AuditPage> {
    return this.list('audit', params, signal);
  }

  getMetrics(signal?: AbortSignal): Promise<Metrics> {
    return this.request('GET', '/v1/admin/metrics', { signal });
  }

  // Full replacement: the body id must equal the route id.
  updateModel(model: ModelConfig, idempotencyKey: string): Promise<ModelConfig> {
    return this.update('models', model.id, model, idempotencyKey);
  }

  updateTool(tool: ToolConfig, idempotencyKey: string): Promise<ToolConfig> {
    return this.update('tools', tool.name, tool, idempotencyKey);
  }

  updateProcedure(procedure: Procedure, idempotencyKey: string): Promise<Procedure> {
    return this.update('procedures', procedure.id, procedure, idempotencyKey);
  }

  private list<T>(resource: string, { cursor, limit }: PageParams, signal?: AbortSignal): Promise<T> {
    const query = new URLSearchParams();
    if (cursor) query.set('cursor', cursor);
    if (limit !== undefined) query.set('limit', String(limit));
    const suffix = query.size > 0 ? `?${query}` : '';
    return this.request('GET', `/v1/admin/${resource}${suffix}`, { signal });
  }

  private update<T>(resource: string, id: string, body: T, idempotencyKey: string): Promise<T> {
    return this.request('PUT', `/v1/admin/${resource}/${encodeURIComponent(id)}`, { body, idempotencyKey });
  }

  private async request<T>(
    method: 'GET' | 'PUT',
    path: string,
    options: { body?: unknown; idempotencyKey?: string; signal?: AbortSignal },
  ): Promise<T> {
    const headers: Record<string, string> = { traceparent: newTraceparent() };
    if (options.idempotencyKey) headers['idempotency-key'] = options.idempotencyKey;
    if (options.body !== undefined) headers['content-type'] = 'application/json';
    const response = await this.fetchImpl(this.basePath + path, {
      method,
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: options.signal,
    });
    if (!response.ok) throw await toError(response);
    return (await response.json()) as T;
  }
}

async function toError(response: Response): Promise<C3Error> {
  let problem: Problem | undefined;
  try {
    if ((response.headers.get('content-type') ?? '').includes('json')) {
      problem = (await response.json()) as Problem;
    }
  } catch {
    problem = undefined;
  }
  return new C3Error(response.status, problem);
}

/** Shared instance for the pages (same-origin calls only). */
export const c3 = new C3Client();
