import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { generateKeyPair } from 'jose';
import {
  assertSchema,
  callTool,
  CONVERSATION_ID,
  mcpClient,
  rawInitialize,
  startBackendMock,
  startFakeOidc,
  startTooling,
  toolError,
  USER_REF,
} from './helpers.js';

const catalog = JSON.parse(readFileSync(new URL('../../../../contracts/v1/mcp.tools.json', import.meta.url), 'utf8'));
const agentHeaders = { Authorization: 'Bearer mock-agent', 'X-Conversation-Id': CONVERSATION_ID, 'X-User-Ref': USER_REF };

test('catalogue MCP complet et outils de lecture sur le Backend simulé', async (t) => {
  const backend = await startBackendMock(t);
  const tooling = await startTooling(t, { AUTH_MODE: 'mock-tokens', BACKEND_URL: backend });
  const client = await mcpClient(t, tooling, 'mock-agent');

  const { tools } = await client.listTools();
  assert.deepEqual(tools, catalog.tools);

  const search = await callTool(client, 'procedures.search', { query: 'demo', locale: 'fr' });
  assert.ok(!search.isError);
  const items = search.structuredContent!.items as unknown[];
  assert.equal(items.length, 1);
  items.forEach((item) => assertSchema('Procedure', item));
  assert.deepEqual(JSON.parse(search.content[0].text), search.structuredContent);

  const procedure = await callTool(client, 'procedures.get', { procedureId: 'demo-procedure' });
  assertSchema('Procedure', procedure.structuredContent);
});

test('erreurs métier rendues en isError avec code et traceId, jamais en succès', async (t) => {
  const backend = await startBackendMock(t);
  const tooling = await startTooling(t, { AUTH_MODE: 'mock-tokens', BACKEND_URL: backend });
  const client = await mcpClient(t, tooling, 'mock-agent');

  const unknown = toolError(await callTool(client, 'procedures.get', { procedureId: 'absent' }));
  assert.deepEqual(unknown, { code: 'NOT_FOUND', detail: 'Fiche inconnue', traceId: '1'.repeat(32) });
  assert.equal(toolError(await callTool(client, 'procedures.search', { query: 'demo', locale: 'en' })).code, 'INVALID_REQUEST');
  assert.equal(toolError(await callTool(client, 'procedures.search', { query: 'demo', locale: 'fr', userRef: USER_REF })).code, 'INVALID_REQUEST');
  assert.equal(toolError(await callTool(client, 'tools.unknown', {})).code, 'NOT_FOUND');
  assert.equal(toolError(await callTool(client, 'request.create', { procedureId: 'demo-procedure' })).code, 'INVALID_REQUEST');
});

test('Backend injoignable : UPSTREAM_UNAVAILABLE sans détail interne', async (t) => {
  const tooling = await startTooling(t, { AUTH_MODE: 'mock-tokens', BACKEND_URL: 'http://127.0.0.1:9' });
  const client = await mcpClient(t, tooling, 'mock-agent');
  const error = toolError(await callTool(client, 'procedures.search', { query: 'demo', locale: 'fr' }));
  assert.deepEqual(error, { code: 'UPSTREAM_UNAVAILABLE', detail: 'Service Backend indisponible', traceId: '1'.repeat(32) });
});

test('transport : identité, client, contexte et méthode contrôlés avant MCP', async (t) => {
  const tooling = await startTooling(t, { AUTH_MODE: 'mock-tokens' });
  const cases: [Record<string, string>, number, string][] = [
    [{ ...agentHeaders, Authorization: '' }, 401, 'UNAUTHORIZED'],
    [{ ...agentHeaders, Authorization: 'Bearer unknown' }, 401, 'UNAUTHORIZED'],
    [{ ...agentHeaders, Authorization: 'Bearer mock-backend-control' }, 401, 'UNAUTHORIZED'],
    [{ Authorization: 'Bearer mock-agent', 'X-Conversation-Id': CONVERSATION_ID }, 400, 'INVALID_REQUEST'],
    [{ ...agentHeaders, 'X-User-Ref': 'usr_invalid' }, 400, 'INVALID_REQUEST'],
    [{ ...agentHeaders, 'X-Mandate-Id': 'mdt_invalid' }, 400, 'INVALID_REQUEST'],
  ];
  for (const [headers, status, code] of cases) {
    const res = await rawInitialize(tooling, headers);
    assert.equal(res.status, status, JSON.stringify(headers));
    const problem = await res.json();
    assertSchema('Problem', problem);
    assert.equal((problem as { code: string }).code, code);
  }
  const get = await fetch(`${tooling}/mcp`, { headers: { ...agentHeaders, traceparent: `00-${'1'.repeat(32)}-${'2'.repeat(16)}-01` } });
  assert.equal(get.status, 405);
  assert.equal(get.headers.get('allow'), 'POST');
});

test('JWT : signature, émetteur, audience, expiration, algorithme et scope vérifiés', async (t) => {
  const oidc = await startFakeOidc(t);
  const tooling = await startTooling(t, oidc.env);
  const other = await generateKeyPair('RS256');
  const rejected: [string, string, number][] = [
    ['expiré', await oidc.sign({}, { expiresIn: '-2m' }), 401],
    ['autre audience', await oidc.sign({ aud: 'techma-backend' }), 401],
    ['autre émetteur', await oidc.sign({ iss: 'http://127.0.0.1/realms/other' }), 401],
    ['clé inconnue', await oidc.sign({}, { key: other.privateKey }), 401],
    ['sans scope', await oidc.sign({ scope: 'profile' }), 403],
    ['client contrôle mandat', await oidc.sign({ azp: 'backend-mandates', scope: 'mandates:grant' }), 401],
  ];
  for (const [label, token, status] of rejected) {
    const res = await rawInitialize(tooling, { ...agentHeaders, Authorization: `Bearer ${token}` });
    assert.equal(res.status, status, label);
  }
  const unsigned = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from('{"azp":"backend-agent","scope":"tools:call"}').toString('base64url')}.`;
  assert.equal((await rawInitialize(tooling, { ...agentHeaders, Authorization: `Bearer ${unsigned}` })).status, 401);
});

test('JWT : appel complet, jeton tooling-resources obtenu une fois puis réutilisé', async (t) => {
  const oidc = await startFakeOidc(t);
  const backend = await startBackendMock(t);
  const tooling = await startTooling(t, { ...oidc.env, BACKEND_URL: backend });
  const client = await mcpClient(t, tooling, await oidc.sign());
  for (let n = 0; n < 3; n += 1) {
    const search = await callTool(client, 'procedures.search', { query: 'demo', locale: 'fr' });
    assert.ok(!search.isError, search.content[0].text);
  }
  assert.equal(oidc.tokenRequests, 1);
});

test('JWT : jetons sortants préémis utilisés tels quels, sans fournisseur de jetons', async (t) => {
  const oidc = await startFakeOidc(t);
  const backend = await startBackendMock(t);
  const { OIDC_TOKEN_URL: _url, TOOLING_RESOURCES_CLIENT_ID: _a, TOOLING_RESOURCES_CLIENT_SECRET: _b, TOOLING_EVENTS_CLIENT_ID: _c, TOOLING_EVENTS_CLIENT_SECRET: _d, ...realm } = oidc.env;
  const tooling = await startTooling(t, { ...realm, TOOLING_RESOURCES_TOKEN: 'mock-tooling-resources', TOOLING_EVENTS_TOKEN: 'mock-tooling-events', BACKEND_URL: backend });
  const client = await mcpClient(t, tooling, await oidc.sign());
  const search = await callTool(client, 'procedures.search', { query: 'demo', locale: 'fr' });
  assert.ok(!search.isError, search.content[0].text);
  assert.equal(oidc.tokenRequests, 0);
});

test('fiche non conforme renvoyée par le Backend : écartée de la recherche, refusée en lecture', async (t) => {
  const fixtures = JSON.parse(readFileSync(new URL('../../../../mocks/fixtures.json', import.meta.url), 'utf8'));
  const valid = fixtures.schemas.Procedure;
  const broken = { ...valid, id: 'broken-procedure', requiredDocuments: 'demo-document' };
  const backend = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const body = url.pathname === '/internal/v1/procedures' ? { items: [valid, broken], nextCursor: null } : url.pathname.endsWith('/broken-procedure') ? broken : { ...valid, id: 'other-id' };
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(body));
  });
  await new Promise<void>((resolve) => backend.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve) => backend.close(() => resolve())));
  const tooling = await startTooling(t, { AUTH_MODE: 'mock-tokens', BACKEND_URL: `http://127.0.0.1:${(backend.address() as AddressInfo).port}` });
  const client = await mcpClient(t, tooling, 'mock-agent');
  const search = await callTool(client, 'procedures.search', { query: 'demo', locale: 'fr' });
  assert.deepEqual((search.structuredContent?.items as { id: string }[]).map((item) => item.id), [valid.id]);
  assert.equal(toolError(await callTool(client, 'procedures.get', { procedureId: 'broken-procedure' })).code, 'UPSTREAM_UNAVAILABLE');
  assert.equal(toolError(await callTool(client, 'procedures.get', { procedureId: valid.id })).code, 'UPSTREAM_UNAVAILABLE', 'fiche renvoyée sous un autre identifiant');
});

test('fiches en brouillon masquées quand elles ne sont pas autorisées (règle de production)', async (t) => {
  const backend = await startBackendMock(t);
  const tooling = await startTooling(t, { AUTH_MODE: 'mock-tokens', PROCEDURES_ALLOW_DRAFTS: 'false', BACKEND_URL: backend });
  const client = await mcpClient(t, tooling, 'mock-agent');
  const search = await callTool(client, 'procedures.search', { query: 'demo', locale: 'fr' });
  assert.deepEqual(search.structuredContent, { items: [] });
  assert.equal(toolError(await callTool(client, 'procedures.get', { procedureId: 'demo-procedure' })).code, 'NOT_FOUND');
});
