// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// @ts-expect-error -- plain ESM mock server without types
import { startMocks } from '../../../../mocks/server.mjs';
import { C3Client, C3Error } from '@/lib/c3-client';
import { proxyToAdmin } from '@/server/admin-proxy';

type Mocks = { backendUrl: string; close: () => Promise<void> };
let mocks: Mocks;

beforeAll(async () => {
  mocks = await startMocks({ backendPort: 0, toolingPort: 0 });
});
afterAll(async () => {
  await mocks.close();
});

const shimWith =
  (token: string): typeof fetch =>
  async (input, init) => {
    const url = new URL(String(input), 'http://console.local');
    const path = url.pathname.replace(/^\/api\/admin\//, '').split('/');
    return proxyToAdmin(new Request(url, init), path, {
      backendUrl: mocks.backendUrl,
      getAdminToken: () => token,
      fetch,
    });
  };

describe('console <-> proxy <-> mock backend', () => {
  it('lists procedures, models, tools, conversations and audit and reads metrics', async () => {
    // The mock starts without conversations: create one as a user (outside the console).
    await fetch(new URL('/v1/conversations', mocks.backendUrl), {
      method: 'POST',
      headers: {
        authorization: 'Bearer mock-user',
        'content-type': 'application/json',
        'idempotency-key': crypto.randomUUID(),
        traceparent: '00-' + 'a'.repeat(32) + '-' + 'b'.repeat(16) + '-01',
      },
      body: JSON.stringify({ channel: 'web', locale: 'fr' }),
    });

    const client = new C3Client(shimWith('mock-admin'));
    const procedures = await client.listProcedures({ limit: 20 });
    expect(procedures.items.map((p) => p.id)).toContain('demo-procedure');
    expect(procedures.nextCursor).toBeNull();
    expect((await client.listModels()).items.length).toBeGreaterThanOrEqual(1);
    expect((await client.listTools()).items.length).toBeGreaterThanOrEqual(1);
    const conversations = await client.listConversations();
    expect(conversations.items.length).toBeGreaterThanOrEqual(1);
    expect(conversations.items[0]).toMatchObject({ channel: 'web', locale: 'fr' });
    expect(Array.isArray((await client.listAudit()).items)).toBe(true);
    expect(await client.getMetrics()).toEqual(
      expect.objectContaining({ conversationCount: expect.any(Number), sourcedAnswerRate: expect.any(Number) }),
    );
  });

  it('paginates with the opaque cursor', async () => {
    const client = new C3Client(shimWith('mock-admin'));
    const first = await client.listTools({ limit: 3 });
    expect(first.items).toHaveLength(3);
    expect(first.nextCursor).not.toBeNull();
    const second = await client.listTools({ cursor: first.nextCursor, limit: 3 });
    expect(second.items[0].name).not.toBe(first.items[0].name);
  });

  it('PUTs the procedure back unchanged, then finds configuration.changed in the audit', async () => {
    const client = new C3Client(shimWith('mock-admin'));
    const procedure = (await client.listProcedures()).items.find((p) => p.id === 'demo-procedure')!;
    const updated = await client.updateProcedure(procedure, crypto.randomUUID());
    expect(updated).toEqual(procedure);

    const audit = await client.listAudit({ limit: 100 });
    expect(audit.items).toContainEqual(
      expect.objectContaining({ action: 'configuration.changed.updated', resourceId: 'demo-procedure' }),
    );
  });

  it('updates a model, toggles a tool and edits a procedure through the proxy, with audit entries', async () => {
    const client = new C3Client(shimWith('mock-admin'));
    const changes = async (resourceId: string) =>
      (await client.listAudit({ limit: 100 })).items.filter(
        (entry) => entry.action === 'configuration.changed.updated' && entry.resourceId === resourceId,
      ).length;

    const model = (await client.listModels()).items[0];
    const tool = (await client.listTools({ limit: 100 })).items[0];
    const procedure = (await client.listProcedures()).items.find((p) => p.id === 'demo-procedure')!;
    const before = [await changes(model.id), await changes(tool.name), await changes(procedure.id)];

    const savedModel = await client.updateModel({ ...model, temperature: 1.4 }, `model-${crypto.randomUUID()}`);
    const savedTool = await client.updateTool({ ...tool, enabled: !tool.enabled }, `tool-${crypto.randomUUID()}`);
    const savedProcedure = await client.updateProcedure(
      { ...procedure, summary: 'Résumé modifié.', validationStatus: 'validated' },
      `procedure-${crypto.randomUUID()}`,
    );
    expect(savedModel.temperature).toBe(1.4);
    expect(savedTool.enabled).toBe(!tool.enabled);
    expect(savedProcedure).toMatchObject({ summary: 'Résumé modifié.', validationStatus: 'validated' });

    expect((await client.listModels()).items.find((m) => m.id === model.id)?.temperature).toBe(1.4);
    expect((await client.listTools({ limit: 100 })).items.find((t) => t.name === tool.name)?.enabled).toBe(!tool.enabled);
    expect((await client.listProcedures()).items.find((p) => p.id === procedure.id)).toMatchObject({
      summary: 'Résumé modifié.',
      validationStatus: 'validated',
    });
    expect([await changes(model.id), await changes(tool.name), await changes(procedure.id)]).toEqual(
      before.map((count) => count + 1),
    );
  });

  it('maps a missing resource to a 404 C3Error', async () => {
    const client = new C3Client(shimWith('mock-admin'));
    const procedure = (await client.listProcedures()).items[0];
    const error = await client
      .updateProcedure({ ...procedure, id: 'unknown-procedure' }, crypto.randomUUID())
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(C3Error);
    expect((error as C3Error).status).toBe(404);
    expect((error as C3Error).problem?.code).toBe('NOT_FOUND');
  });

  it('maps a user token to a 403 C3Error', async () => {
    const error = await new C3Client(shimWith('mock-user')).listModels().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(C3Error);
    expect((error as C3Error).status).toBe(403);
  });
});
