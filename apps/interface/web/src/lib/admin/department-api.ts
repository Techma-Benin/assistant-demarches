import type { DepartmentAdminPaths } from '@techma/contracts-ts';
import { C3Error, type Problem } from '@/lib/operator/c3-client';
import { newTraceparent } from '@/lib/trace';

type Ok<Op extends { responses: { 200: { content: { 'application/json': unknown } } } }> =
  Op['responses'][200]['content']['application/json'];

export type WorkItemPage = Ok<NonNullable<DepartmentAdminPaths['/v1/admin/work-items']['get']>>;
export type AdminWorkItem = WorkItemPage['items'][number];
export type Dashboard = Ok<NonNullable<DepartmentAdminPaths['/v1/admin/dashboard']['get']>>;
export type ActivityPage = Ok<NonNullable<DepartmentAdminPaths['/v1/admin/activity']['get']>>;
export type ActivityEntry = ActivityPage['items'][number];
export type UnansweredPage = Ok<NonNullable<DepartmentAdminPaths['/v1/admin/unanswered']['get']>>;
export type UnansweredEntry = UnansweredPage['items'][number];
export type AdminUserPage = Ok<NonNullable<DepartmentAdminPaths['/v1/admin/users']['get']>>;
export type AdminUser = AdminUserPage['items'][number];
export type ResolutionResult = Ok<NonNullable<DepartmentAdminPaths['/v1/admin/unanswered/{id}/resolve']['post']>>;

export type RequestStatus = AdminWorkItem['status'];
export type WorkItemFilter = 'pending' | 'completed' | 'draft' | 'all';
export type WorkAction = 'claim' | 'request_information' | 'approve' | 'reject' | 'resume';

export interface AdminCommand {
  action: WorkAction;
  revision: number;
  reason?: string;
}

export interface ListParams {
  departmentId?: string | null;
  cursor?: string | null;
  limit?: number;
}

/** Client of the department console routes (through the BFF, which adds the session token). */
export class DepartmentClient {
  constructor(
    private readonly fetchImpl: typeof fetch = (...args) => fetch(...args),
    readonly basePath = '/api/admin',
  ) {}

  listWorkItems(
    params: ListParams & { status?: WorkItemFilter },
    signal?: AbortSignal,
  ): Promise<WorkItemPage> {
    return this.get('/work-items', { ...paging(params), status: params.status }, signal);
  }

  getWorkItem(id: string, signal?: AbortSignal): Promise<AdminWorkItem> {
    return this.get(`/work-items/${encodeURIComponent(id)}`, {}, signal);
  }

  /** One `idempotencyKey` per intent: a retry of the same intent reuses it. */
  act(id: string, command: AdminCommand, idempotencyKey: string): Promise<AdminWorkItem> {
    return this.post(`/work-items/${encodeURIComponent(id)}/actions`, command, idempotencyKey);
  }

  documentUrl(id: string, fileId: string): string {
    return `${this.basePath}/v1/admin/work-items/${encodeURIComponent(id)}/documents/${encodeURIComponent(fileId)}`;
  }

  getDashboard(
    params: { departmentId?: string | null; from?: string; to?: string },
    signal?: AbortSignal,
  ): Promise<Dashboard> {
    return this.get('/dashboard', params, signal);
  }

  listActivity(params: ListParams, signal?: AbortSignal): Promise<ActivityPage> {
    return this.get('/activity', paging(params), signal);
  }

  listUnanswered(params: ListParams, signal?: AbortSignal): Promise<UnansweredPage> {
    return this.get('/unanswered', paging(params), signal);
  }

  resolveUnanswered(id: string, idempotencyKey: string): Promise<ResolutionResult> {
    return this.post(`/unanswered/${encodeURIComponent(id)}/resolve`, {}, idempotencyKey);
  }

  listUsers(params: ListParams, signal?: AbortSignal): Promise<AdminUserPage> {
    return this.get('/users', paging(params), signal);
  }

  private get<T>(
    path: string,
    query: Record<string, string | number | null | undefined>,
    signal?: AbortSignal,
  ): Promise<T> {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
    }
    const suffix = search.size > 0 ? `?${search}` : '';
    return this.request('GET', path + suffix, { signal });
  }

  private post<T>(path: string, body: unknown, idempotencyKey: string): Promise<T> {
    return this.request('POST', path, { body, idempotencyKey });
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    options: { body?: unknown; idempotencyKey?: string; signal?: AbortSignal },
  ): Promise<T> {
    const headers: Record<string, string> = { traceparent: newTraceparent() };
    if (options.idempotencyKey) headers['idempotency-key'] = options.idempotencyKey;
    if (options.body !== undefined) headers['content-type'] = 'application/json';
    const response = await this.fetchImpl(`${this.basePath}/v1/admin${path}`, {
      method,
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: options.signal,
    });
    if (!response.ok) throw await toError(response);
    return (await response.json()) as T;
  }
}

function paging({ departmentId, cursor, limit }: ListParams) {
  return { departmentId, cursor, limit };
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
export const departmentApi = new DepartmentClient();
