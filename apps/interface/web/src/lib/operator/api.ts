import type { OperatorPaths, Schemas } from '@techma/contracts-ts';
import { newTraceparent } from '@/lib/trace';
import type { Problem } from './c3-client';

type Ok<Op extends { responses: { 200: { content: { 'application/json': unknown } } } }> =
  Op['responses'][200]['content']['application/json'];

export type ModelConfig = Schemas['ModelConfig'];
export type McpServer = Schemas['McpServer'];
export type McpAuth = Schemas['McpAuth'];
export type McpTool = Schemas['McpTool'];
export type McpToolPermission = Schemas['McpToolPermission'];
export type McpToolList = Ok<NonNullable<OperatorPaths['/v1/operator/mcp-servers/{id}/tools']['get']>>;
export type OperatorStatus = Ok<NonNullable<OperatorPaths['/v1/operator/status']['get']>>;

export class OperatorApiError extends Error {
  readonly status: number;
  readonly problem?: Problem;

  constructor(status: number, problem?: Problem) {
    super(problem?.detail ?? `Erreur (HTTP ${status})`);
    this.name = 'OperatorApiError';
    this.status = status;
    this.problem = problem;
  }
}

/** French message for the screen: the server's own detail when it gave one. */
export function describeError(error: unknown): string {
  if (error instanceof OperatorApiError) {
    if (error.problem?.detail) return error.problem.detail;
    if (error.status === 401) return 'Session expirée : reconnectez-vous.';
    if (error.status === 403) return 'Accès réservé à l’opérateur.';
    if (error.status === 404) return 'Élément introuvable.';
    if (error.status >= 500) return 'Service momentanément indisponible.';
  }
  return 'Une erreur est survenue. Réessayez.';
}

const BASE = '/api/operator/v1/operator';
const MAX_PAGES = 20;

async function request<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const headers: Record<string, string> = { traceparent: newTraceparent() };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(BASE + path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal,
  });
  if (!response.ok) {
    let problem: Problem | undefined;
    try {
      if ((response.headers.get('content-type') ?? '').includes('json')) problem = (await response.json()) as Problem;
    } catch {
      problem = undefined;
    }
    throw new OperatorApiError(response.status, problem);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

async function listAll<T>(path: string, signal?: AbortSignal): Promise<T[]> {
  const items: T[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const query: string = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
    const result: { items: T[]; nextCursor: string | null } = await request('GET', path + query, undefined, signal);
    items.push(...result.items);
    cursor = result.nextCursor;
    if (!cursor) break;
  }
  return items;
}

const enc = encodeURIComponent;

export const operatorApi = {
  listModels: (signal?: AbortSignal) => listAll<ModelConfig>('/models', signal),
  createModel: (model: ModelConfig) => request<ModelConfig>('POST', '/models', model),
  updateModel: (model: ModelConfig) => request<ModelConfig>('PUT', `/models/${enc(model.id)}`, model),
  deleteModel: (id: string) => request<void>('DELETE', `/models/${enc(id)}`),

  listServers: (signal?: AbortSignal) => listAll<McpServer>('/mcp-servers', signal),
  createServer: (server: McpServer) => request<McpServer>('POST', '/mcp-servers', server),
  deleteServer: (id: string) => request<void>('DELETE', `/mcp-servers/${enc(id)}`),
  discover: (id: string) => request<McpToolList>('POST', `/mcp-servers/${enc(id)}/discover`),
  listTools: (id: string, signal?: AbortSignal) =>
    request<McpToolList>('GET', `/mcp-servers/${enc(id)}/tools`, undefined, signal),
  setToolPermission: (id: string, toolName: string, permission: McpToolPermission) =>
    request<unknown>('PUT', `/mcp-servers/${enc(id)}/tools/${enc(toolName)}`, permission),

  status: (signal?: AbortSignal) => request<OperatorStatus>('GET', '/status', undefined, signal),
};
