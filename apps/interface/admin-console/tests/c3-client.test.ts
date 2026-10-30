import { describe, expect, it, vi } from 'vitest';
import { C3Client, C3Error, type ModelConfig, type Procedure, type ToolConfig } from '@/lib/c3-client';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function setup(response: () => Response = () => json({ items: [], nextCursor: null })) {
  const fake = vi.fn(async (..._args: unknown[]) => response());
  return { fake, client: new C3Client(fake as unknown as typeof fetch) };
}

const call = (fake: ReturnType<typeof setup>['fake']) => fake.mock.calls[0] as unknown as [string, RequestInit];

describe('C3Client lists', () => {
  it.each([
    ['listModels', 'models'],
    ['listTools', 'tools'],
    ['listProcedures', 'procedures'],
    ['listConversations', 'conversations'],
    ['listAudit', 'audit'],
  ] as const)('%s calls the same-origin proxy with a traceparent and no idempotency key', async (method, resource) => {
    const { fake, client } = setup();
    expect(await client[method]()).toEqual({ items: [], nextCursor: null });
    const [url, init] = call(fake);
    expect(url).toBe(`/api/admin/v1/admin/${resource}`);
    expect(init.method).toBe('GET');
    const headers = init.headers as Record<string, string>;
    expect(headers.traceparent).toMatch(/^00-[a-f0-9]{32}-[a-f0-9]{16}-01$/);
    expect(headers['idempotency-key']).toBeUndefined();
    expect(init.body).toBeUndefined();
  });

  it('sends cursor and limit, encoded', async () => {
    const { fake, client } = setup();
    await client.listAudit({ cursor: 'a b&c', limit: 20 });
    expect(call(fake)[0]).toBe('/api/admin/v1/admin/audit?cursor=a+b%26c&limit=20');
  });

  it('omits a null cursor', async () => {
    const { fake, client } = setup();
    await client.listModels({ cursor: null, limit: 20 });
    expect(call(fake)[0]).toBe('/api/admin/v1/admin/models?limit=20');
  });

  it('uses a fresh traceparent on every call', async () => {
    const { fake, client } = setup();
    await client.listModels();
    await client.listModels();
    const [a, b] = fake.mock.calls.map((c) => ((c[1] as RequestInit).headers as Record<string, string>).traceparent);
    expect(a).not.toBe(b);
  });

  it('reads metrics', async () => {
    const metrics = { conversationCount: 1, p95LatencyMs: 2, sourcedAnswerRate: 0.5, errorCount: 0 };
    const { fake, client } = setup(() => json(metrics));
    expect(await client.getMetrics()).toEqual(metrics);
    expect(call(fake)[0]).toBe('/api/admin/v1/admin/metrics');
  });
});

describe('C3Client updates', () => {
  const model: ModelConfig = { id: 'm/1', provider: 'p', model: 'x', promptVersion: 'v1', temperature: 0.2, active: true };
  const tool: ToolConfig = { name: 'search tool', enabled: true, serverUrl: 'http://x.test/mcp', secretRef: 'ref' };

  it('PUTs a model with idempotency key, JSON body and encoded id', async () => {
    const { fake, client } = setup(() => json(model));
    expect(await client.updateModel(model, 'key-123')).toEqual(model);
    const [url, init] = call(fake);
    expect(url).toBe('/api/admin/v1/admin/models/m%2F1');
    expect(init.method).toBe('PUT');
    expect(init.body).toBe(JSON.stringify(model));
    const headers = init.headers as Record<string, string>;
    expect(headers['idempotency-key']).toBe('key-123');
    expect(headers['content-type']).toBe('application/json');
    expect(headers.traceparent).toMatch(/^00-[a-f0-9]{32}-[a-f0-9]{16}-01$/);
  });

  it('uses the tool name as route id', async () => {
    const { fake, client } = setup(() => json(tool));
    await client.updateTool(tool, 'key-123');
    expect(call(fake)[0]).toBe('/api/admin/v1/admin/tools/search%20tool');
  });

  it('PUTs a procedure by id', async () => {
    const procedure = { id: 'demo-procedure' } as Procedure;
    const { fake, client } = setup(() => json(procedure));
    await client.updateProcedure(procedure, 'key-123');
    expect(call(fake)[0]).toBe('/api/admin/v1/admin/procedures/demo-procedure');
  });
});

describe('C3Client errors', () => {
  it('maps a problem+json response to C3Error', async () => {
    const problem = { code: 'CONFLICT', detail: 'Conflit', status: 409, traceId: 'a'.repeat(32) };
    const { client } = setup(
      () => new Response(JSON.stringify(problem), { status: 409, headers: { 'content-type': 'application/problem+json' } }),
    );
    const error = await client.updateModel({} as ModelConfig, 'k').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(C3Error);
    expect(error).toMatchObject({ status: 409, message: 'Conflit', problem });
  });

  it('keeps the status when the body is not JSON', async () => {
    const { client } = setup(() => new Response('oops', { status: 502, headers: { 'content-type': 'text/html' } }));
    const error = await client.listModels().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(C3Error);
    expect(error).toMatchObject({ status: 502, message: 'Erreur C3 (HTTP 502)', problem: undefined });
  });
});
