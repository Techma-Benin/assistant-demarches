import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { generateKeyPair } from 'jose';
import { act, CONVERSATION_ID, mcpClient, startStack, toolError, TRACEPARENT, USER_REF } from './helpers.js';

const contract = JSON.parse(readFileSync(new URL('../../../../contracts/v2/mcp.tools.json', import.meta.url), 'utf8')) as { tools: { name: string }[] };

async function rawInitialize(url: string, headers: Record<string, string>) {
  return fetch(`${url}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...headers },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'raw', version: '1' } } }),
  });
}

test('découverte : les 9 outils du contrat v2, sans contexte, pour le seul client backend', async (t) => {
  const s = await startStack(t);
  const client = await mcpClient(s, {});
  t.after(() => client.close());
  const listed = await client.listTools();
  assert.deepEqual(
    listed.tools.map((tool) => tool.name).sort(),
    contract.tools.map((tool) => tool.name).sort(),
  );
  assert.equal(listed.tools.length, 9);
  assert.ok(!listed.tools.some((tool) => tool.name === 'documents.verify'), 'documents.verify a disparu');
  const refused = (await client.callTool({ name: 'procedures.search', arguments: { query: 'casier' } })) as never;
  assert.equal(toolError(refused).code, 'INVALID_REQUEST', 'tools/call sans contexte refusé');
});

test('identité : jeton Keycloak du client backend, audience techma-tooling, scope tools:call', async (t) => {
  const s = await startStack(t);
  const k = s.keycloak;
  const { privateKey: stranger } = await generateKeyPair('RS256');
  const cases: Array<[string, Record<string, string>, number]> = [
    ['aucun jeton', {}, 401],
    ['jeton opaque', { Authorization: 'Bearer mock-agent' }, 401],
    ['autre client', { Authorization: `Bearer ${await k.sign({ azp: 'tooling', scope: 'tools:call' })}` }, 401],
    ['autre audience', { Authorization: `Bearer ${await k.backend('tools:call', 'techma-backend')}` }, 401],
    ['autre émetteur', { Authorization: `Bearer ${await k.sign({ azp: 'backend', scope: 'tools:call' }, { issuer: 'http://127.0.0.1:1/realms/other' })}` }, 401],
    ['clé inconnue', { Authorization: `Bearer ${await k.sign({ azp: 'backend', scope: 'tools:call' }, { key: stranger })}` }, 401],
    ['expiré', { Authorization: `Bearer ${await k.sign({ azp: 'backend', scope: 'tools:call' }, { expiresIn: '-2m' })}` }, 401],
    ['scope des mandats seulement', { Authorization: `Bearer ${await k.backend('mandates:grant')}` }, 403],
  ];
  for (const [label, headers, status] of cases) {
    const res = await rawInitialize(s.url, { traceparent: TRACEPARENT, ...headers });
    assert.equal(res.status, status, label);
    assert.match(res.headers.get('content-type') ?? '', /^application\/problem\+json/, label);
  }
  assert.equal((await rawInitialize(s.url, { Authorization: `Bearer ${await k.backend('tools:call')}` })).status, 200);
});

test('contexte : en-têtes validés, X-Channel limité à web et whatsapp, méthodes autres que POST refusées', async (t) => {
  const s = await startStack(t);
  const token = await s.keycloak.backend('tools:call');
  const base = { Authorization: `Bearer ${token}`, 'X-Conversation-Id': CONVERSATION_ID, 'X-User-Ref': USER_REF };
  assert.equal((await rawInitialize(s.url, base)).status, 200);
  assert.equal((await rawInitialize(s.url, { ...base, 'X-User-Ref': 'usr_bad' })).status, 400);
  assert.equal((await rawInitialize(s.url, { ...base, 'X-Channel': 'sms' })).status, 400);
  assert.equal((await rawInitialize(s.url, { ...base, 'X-Mandate-Id': 'mdt_bad' })).status, 400);
  assert.equal((await rawInitialize(s.url, { ...base, 'X-Channel': 'whatsapp' })).status, 200);
  const get = await fetch(`${s.url}/mcp`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(get.status, 405);
});

test('catalogue : les fiches viennent du X-Road, avec filing pour les démarches déposables', async (t) => {
  const s = await startStack(t);
  const search = await act(s, 'procedures.search', { query: 'casier judiciaire' });
  const items = search.structuredContent!.items as Array<{ id: string; filing: unknown; source: { url: string } }>;
  const casier = items.find((item) => item.id === 'PS00373');
  assert.ok(casier, 'PS00373 trouvée');
  assert.match(casier.source.url, /service-public\.bj/);
  const fiche = await act(s, 'procedures.get', { procedureId: 'PS00373' });
  const filing = fiche.structuredContent!.filing as { feeFcfa: number; requiredDocuments: unknown[] };
  assert.equal(filing.feeFcfa, 1900);
  assert.equal(filing.requiredDocuments.length, 1);
  assert.equal(toolError(await act(s, 'procedures.get', { procedureId: 'PS99999' })).code, 'NOT_FOUND');
  assert.equal(toolError(await act(s, 'procedures.search', { query: '' })).code, 'INVALID_REQUEST');
});
