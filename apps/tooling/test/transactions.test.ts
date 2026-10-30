import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { test, type TestContext } from 'node:test';
import { loadConfig } from '../src/config.js';
import { act, grantMandate, startBackendMock, startToolingApp } from './helpers.js';

interface SlowBackend {
  url: string;
  delayMs: number;
  down: boolean;
  procedureCalls: number;
}

async function slowBackend(t: TestContext, target: string): Promise<SlowBackend> {
  const state: SlowBackend = { url: '', delayMs: 0, down: false, procedureCalls: 0 };
  const server = http.createServer(async (req, res) => {
    if (state.down) {
      res.writeHead(503, { 'content-type': 'application/problem+json' }).end('{}');
      return;
    }
    if (req.url?.startsWith('/internal/v1/procedures')) {
      state.procedureCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, state.delayMs));
    }
    const headers = Object.fromEntries(Object.entries(req.headers).filter(([name]) => ['authorization', 'traceparent', 'x-user-ref', 'accept'].includes(name))) as Record<string, string>;
    const upstream = await fetch(`${target}${req.url}`, { headers });
    res.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') ?? 'application/json' }).end(await upstream.text());
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  state.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return state;
}

test('un appel au Backend lent ne bloque pas la base : les autres outils continuent', async (t) => {
  const backend = await slowBackend(t, await startBackendMock(t));
  const { url } = await startToolingApp(t, { AUTH_MODE: 'mock-tokens', BACKEND_URL: backend.url, DATABASE_POOL_MAX: '1' });
  const { body } = await grantMandate(url);
  const created = await act(url, 'request.create', { procedureId: 'demo-procedure' }, { mandateId: body.id as string });
  const requestId = created.structuredContent!.id as string;

  backend.delayMs = 1500;
  const slow = act(url, 'request.update', { requestId, fields: { displayName: 'Lent' } }, { mandateId: body.id as string });
  await new Promise((resolve) => setTimeout(resolve, 300));
  const started = Date.now();
  const status = await act(url, 'request.status', { requestId });
  const elapsed = Date.now() - started;
  assert.ok(!status.isError);
  assert.ok(elapsed < 900, `request.status a attendu ${elapsed} ms derrière l'appel lent`);
  const updated = await slow;
  assert.equal(updated.structuredContent?.fields && (updated.structuredContent.fields as Record<string, unknown>).displayName, 'Lent');
});

test('rejeu d’une action déjà faite : réponse enregistrée, sans appel au Backend', async (t) => {
  const backend = await slowBackend(t, await startBackendMock(t));
  const { url } = await startToolingApp(t, { AUTH_MODE: 'mock-tokens', BACKEND_URL: backend.url });
  const { body } = await grantMandate(url);
  const key = randomUUID();
  const first = await act(url, 'request.create', { procedureId: 'demo-procedure' }, { mandateId: body.id as string, key });
  assert.ok(!first.isError);
  const calls = backend.procedureCalls;

  backend.down = true;
  const replay = await act(url, 'request.create', { procedureId: 'demo-procedure' }, { mandateId: body.id as string, key });
  assert.deepEqual(replay.structuredContent, first.structuredContent);
  assert.equal(backend.procedureCalls, calls);
  const fresh = await act(url, 'request.create', { procedureId: 'demo-procedure' }, { mandateId: body.id as string });
  assert.equal(JSON.parse(fresh.content[0].text).code, 'UPSTREAM_UNAVAILABLE');
});

test('fiches en brouillon : refusées par défaut hors du poste local', () => {
  assert.equal(loadConfig({ AUTH_MODE: 'mock-tokens' }).allowDraftProcedures, true);
  assert.equal(loadConfig({ AUTH_MODE: 'mock-tokens', TOOLING_HOST: 'localhost' }).allowDraftProcedures, true);
  const realm = {
    JWT_ISSUER: 'https://idp.example/realms/techma',
    JWKS_URL: 'https://idp.example/certs',
    OIDC_TOKEN_URL: 'https://idp.example/token',
    TOOLING_RESOURCES_CLIENT_ID: 'r',
    TOOLING_RESOURCES_CLIENT_SECRET: 'r',
    TOOLING_EVENTS_CLIENT_ID: 'e',
    TOOLING_EVENTS_CLIENT_SECRET: 'e',
    PROOF_JWKS_URL: 'https://backend.example/jwks',
  };
  assert.equal(loadConfig({ ...realm, TOOLING_HOST: '0.0.0.0' }).allowDraftProcedures, false);
  assert.equal(loadConfig({ ...realm, TOOLING_HOST: '0.0.0.0', PROCEDURES_ALLOW_DRAFTS: 'true' }).allowDraftProcedures, true);
});
