import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { vi } from 'vitest';
import type { McpServer, McpTool, ModelConfig, OperatorStatus } from '@/lib/operator/api';

const spec = JSON.parse(
  readFileSync(resolve(process.cwd(), '../../../contracts/v2/operator.openapi.json'), 'utf8'),
);
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
ajv.addSchema(spec, 'operator');

/** Throws unless `value` conforms to the named schema of operator.openapi.json. */
export function assertContract(name: string, value: unknown): void {
  const validate = ajv.getSchema(`operator#/components/schemas/${name}`);
  if (!validate) throw new Error(`Unknown schema ${name}`);
  if (!validate(value)) throw new Error(`${name}: ${ajv.errorsText(validate.errors)}`);
}

export const groq: ModelConfig = {
  id: 'groq-llama',
  label: 'Groq Llama',
  baseUrl: 'https://api.groq.com/openai/v1',
  protocol: 'chat-completions',
  model: 'llama-3.3-70b-versatile',
  apiKeyRef: 'GROQ_API_KEY',
  temperature: 0.2,
  active: true,
};
export const mistral: ModelConfig = {
  id: 'mistral-small',
  label: 'Mistral Small',
  baseUrl: 'https://api.mistral.ai/v1',
  protocol: 'responses',
  model: 'mistral-small-latest',
  apiKeyRef: 'MISTRAL_API_KEY',
  temperature: 0.7,
  active: false,
};
export const techma: McpServer = {
  id: 'techma',
  name: 'Serveur Techma',
  url: 'http://tooling:4020/mcp',
  enabled: true,
  auth: { type: 'none' },
};
export const searchTool: McpTool = {
  serverId: 'techma',
  name: 'procedures.search',
  description: 'Cherche une démarche.',
  inputSchema: {},
  enabled: false,
  requiresMandate: true,
};
export const submitTool: McpTool = {
  serverId: 'techma',
  name: 'request.submit',
  description: 'Dépose une demande.',
  inputSchema: {},
  enabled: true,
  requiresMandate: true,
};
export const status: OperatorStatus = {
  model: { id: 'groq-llama', label: 'Groq Llama', reachable: true },
  mcpServers: [
    { id: 'techma', name: 'Serveur Techma', enabled: true, reachable: true, toolCount: 2, checkedAt: '2026-11-02T09:00:00Z' },
    { id: 'autre', name: 'Autre serveur', enabled: true, reachable: false, toolCount: 0, checkedAt: '2026-11-02T09:00:00Z' },
  ],
  administrations: [
    {
      id: 'justice',
      name: 'Ministère de la Justice',
      shortName: 'Justice',
      themes: ['Justice'],
      connection: { status: 'connected', since: '2026-10-01T08:00:00Z' },
    },
    {
      id: 'anip',
      name: 'ANIP',
      shortName: 'ANIP',
      themes: ['Identité'],
      connection: { status: 'not_connected', since: null },
    },
  ],
};

export interface Call {
  method: string;
  path: string;
  body: unknown;
}

type Handler = (call: Call) => Response | Promise<Response> | undefined;

export const json = (body: unknown, status = 200) => Response.json(body, { status });
export const problem = (status: number, code: string, detail: string) =>
  new Response(JSON.stringify({ type: 'about:blank', title: code, status, detail, code, traceId: '0'.repeat(32) }), {
    status,
    headers: { 'content-type': 'application/problem+json' },
  });

/** Stubs fetch for `/api/operator/v1/operator/*`; `handlers` win over a 599 default. Returns the recorded calls. */
export function stubOperator(...handlers: Handler[]): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const call: Call = {
      method: (init?.method ?? 'GET').toUpperCase(),
      path: url.replace('/api/operator/v1/operator', ''),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(call);
    for (const handler of handlers) {
      const response = await handler(call);
      if (response) return response;
    }
    return new Response('unexpected', { status: 599 });
  });
  return calls;
}
