import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test, type TestContext } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ConfigError, loadConfig } from '../src/config.js';
import { domainValidator, errorsText } from '../src/contracts.js';
import {
  TRACEPARENT,
  USER_REF,
  act,
  assertSchema,
  callTool,
  grantMandate,
  mcpClient,
  postInternal,
  startBackendMock,
  startToolingApp,
  startXroadSim,
  toFields,
  toolError,
  uploadFile,
} from './helpers.js';

const JUSTICE_AGENT = `off_01JC${'0'.repeat(20)}11`;
const ENSEIGNEMENT_AGENT = `off_01JC${'0'.repeat(20)}13`;
const CASIER = 'PS00373';
const CASIER_FIELDS = { adresseDomicile: 'Cotonou, Cadjèhoun', profession: 'Comptable', nombreEnfantsACharge: 2, situationMatrimoniale: 'Marié' };
const CASIER_DOCUMENTS = ['extrait-acte-naissance'];

async function official(simUrl: string, method: string, path: string, officialId: string, body?: unknown) {
  const res = await fetch(`${simUrl}${path}`, {
    method,
    headers: {
      Authorization: 'Bearer mock-backend-xroad',
      traceparent: TRACEPARENT,
      'X-Official-Subject': officialId,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as any };
}

async function stack(t: TestContext, env: NodeJS.ProcessEnv = {}, simEnv: NodeJS.ProcessEnv = {}) {
  const backend = await startBackendMock(t);
  const sim = await startXroadSim(t, simEnv);
  const tooling = await startToolingApp(t, {
    AUTH_MODE: 'mock-tokens',
    BACKEND_URL: backend,
    XROAD_URL: sim.url,
    CONNECTORS: 'xroad',
    CONNECTOR_WORKER: 'off',
    ...env,
  });
  return { backend, sim, ...tooling };
}

async function prepare(s: Awaited<ReturnType<typeof stack>>, procedureId: string, fields: Record<string, unknown>, documentTypes: string[]) {
  const { body } = await grantMandate(s.url, { procedureId });
  const mandateId = body.id as string;
  const created = await act(s.url, 'request.create', { procedureId }, { mandateId });
  assert.ok(!created.isError, created.content[0].text);
  const requestId = created.structuredContent!.id as string;
  if (Object.keys(fields).length) await act(s.url, 'request.update', { requestId, fields: toFields(fields) }, { mandateId });
  for (const documentType of documentTypes) {
    const attached = await act(s.url, 'documents.attach', { requestId, fileId: await uploadFile(s.backend), documentType }, { mandateId });
    assert.equal(attached.isError, undefined, attached.content[0].text);
  }
  const submitted = await act(s.url, 'request.submit', { requestId }, { mandateId });
  assert.ok(!submitted.isError, submitted.content[0].text);
  const payload = submitted.structuredContent as { request: { status: string; caseId: string }; case: { id: string; status: string } };
  assert.equal(payload.request.status, 'submitted');
  const status = async () => (await act(s.url, 'case.status', { requestId })).structuredContent!;
  return { mandateId, requestId, caseId: payload.case.id, submitted: payload, status };
}

test('catalogue : les fiches viennent du X-Road simulé, avec frais et administration', async (t) => {
  const s = await stack(t);
  const client = await mcpClient(t, s.url, 'mock-agent');
  const search = await callTool(client, 'procedures.search', { query: 'casier' });
  const items = search.structuredContent!.items as any[];
  assert.equal(items[0].id, CASIER, 'la fiche du casier en premier');
  assert.equal(items[0].administrationId, 'justice');
  assert.equal(items[0].feeFcfa, 1900);
  assert.equal(items[0].source.url, 'https://service-public.bj/public/services/service/PS00373');
  const procedure = await callTool(client, 'procedures.get', { procedureId: 'PS00328' });
  assertSchema('Procedure', procedure.structuredContent);
  assert.equal(procedure.structuredContent!.filing, null, 'passeport : information seulement');
  assert.equal(toolError(await callTool(client, 'procedures.get', { procedureId: 'PS00000' })).code, 'NOT_FOUND', 'plus de fiche Backend');
});

test('fiche d’information seulement : aucune demande créée', async (t) => {
  const s = await stack(t);
  const { body } = await grantMandate(s.url, { procedureId: 'PS00328' });
  const refused = await act(s.url, 'request.create', { procedureId: 'PS00328' }, { mandateId: body.id as string });
  assert.equal(toolError(refused).code, 'NOT_ASSISTED');
  const rows = await s.db.transaction('system', (tx) => tx.query('select id from requests'));
  assert.equal(rows.length, 0);
});

test('parcours complet : dépôt X-Road, case.updated, paiement, pas d’événements v1', async (t) => {
  const s = await stack(t);
  assert.equal(toolError(await act(s.url, 'request.create', { procedureId: CASIER }, { authenticated: false })).code, 'LOGIN_REQUIRED');
  const r = await prepare(s, CASIER, CASIER_FIELDS, CASIER_DOCUMENTS);
  assert.equal((await r.status()).status, 'awaiting_payment');
  const paid = await act(s.url, 'request.pay', { requestId: r.requestId }, { mandateId: r.mandateId });
  assert.ok(!paid.isError, paid.content[0].text);
  assert.equal((paid.structuredContent as { payment: { status: string } }).payment.status, 'paid');
  const events = await s.db.transaction('system', (tx) =>
    tx.query<{ type: string; event: unknown }>("select event->>'type' as type, event from outbox order by seq"),
  );
  const validateEvent = domainValidator('Event');
  events.forEach(({ type }) => assert.match(type, /^bj\.techma\.(tool\.called|case\.updated|mandate\.)/));
  const updated = events.filter((row) => row.type === 'bj.techma.case.updated.v2');
  assert.ok(updated.length > 0);
  for (const row of updated) {
    assert.equal(validateEvent(row.event), true, errorsText(validateEvent));
  }
  assert.equal(events.filter((row) => row.type.includes('request.created') || row.type.includes('request.status_changed')).length, 0);
  const pending = await official(s.sim.url, 'GET', '/v1/cases?view=pending', JUSTICE_AGENT);
  assert.deepEqual(pending.body.items.map((item: { id: string }) => item.id), [r.caseId]);
  assert.deepEqual((await official(s.sim.url, 'GET', '/v1/cases?view=pending', ENSEIGNEMENT_AGENT)).body.items, []);
});

test('paiement refusé sans mandat valide : aucun argent ne bouge au X-Road', async (t) => {
  const s = await stack(t);
  const r = await prepare(s, CASIER, CASIER_FIELDS, CASIER_DOCUMENTS);
  assert.equal((await postInternal(s.url, `/internal/v1/mandates/${r.mandateId}/revoke`, undefined)).status, 200);
  const refused = await act(s.url, 'request.pay', { requestId: r.requestId }, { mandateId: r.mandateId });
  assert.equal(toolError(refused).code, 'MANDATE_REVOKED');
  const other = await act(s.url, 'request.pay', { requestId: r.requestId }, { mandateId: r.mandateId, userRef: `usr_${'0'.repeat(25)}9` });
  assert.equal(toolError(other).code, 'NOT_FOUND', 'demande d’un autre usager');
  const filed = s.sim.store.getCase({ kind: 'applicant', applicantRef: USER_REF }, r.caseId);
  assert.equal(filed.payment.status, 'pending');
});

test('découverte MCP sans contexte : catalogue listé pour l’ajout par URL, appel d’outil refusé', async (t) => {
  const s = await stack(t);
  const client = new Client({ name: 'mcp-par-url', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${s.url}/mcp`), { requestInit: { headers: { Authorization: 'Bearer mock-agent', traceparent: TRACEPARENT } } }),
  );
  t.after(() => client.close());
  const listed = await client.listTools();
  assert.equal(listed.tools.length, 9);
  assert.ok(listed.tools.some((tool) => tool.name === 'request.pay'));
  const refused = (await client.callTool({ name: 'procedures.search', arguments: { query: 'casier', locale: 'fr' } })) as any;
  assert.equal(JSON.parse(refused.content[0].text).code, 'INVALID_REQUEST');
});

test('configuration : connecteur xroad lié au X-Road, admis hors poste local, identités de décision et de documents', () => {
  const local = loadConfig({ AUTH_MODE: 'mock-tokens', XROAD_URL: 'http://127.0.0.1:4040', CONNECTORS: 'xroad' });
  assert.equal(local.procedureSource, 'xroad');
  assert.equal(local.snapshots, true);
  assert.deepEqual(local.connectors.enabled, ['xroad']);
  assert.equal(loadConfig({ AUTH_MODE: 'mock-tokens' }).procedureSource, 'backend');
  assert.equal(loadConfig({ AUTH_MODE: 'mock-tokens' }).snapshots, false, 'fiches du Backend : événements v1 inchangés');
  assert.throws(() => loadConfig({ AUTH_MODE: 'mock-tokens', CONNECTORS: 'xroad' }), ConfigError);
  assert.throws(() => loadConfig({ AUTH_MODE: 'mock-tokens', PROCEDURES_SOURCE: 'xroad' }), ConfigError);
  assert.throws(() => loadConfig({ AUTH_MODE: 'mock-tokens', XROAD_URL: 'http://127.0.0.1:4040', PROCEDURES_SOURCE: 'backend', CONNECTORS: 'xroad' }), ConfigError);
  assert.throws(() => loadConfig({ AUTH_MODE: 'mock-tokens', XROAD_URL: 'http://10.0.0.5:4040' }), ConfigError, 'HTTPS hors localhost');

  const production = {
    NODE_ENV: 'production',
    TOOLING_HOST: '0.0.0.0',
    DATABASE_URL: 'postgres://u:p@db/tooling',
    BACKEND_URL: 'https://backend.example',
    XROAD_URL: 'https://xroad.example',
    CONNECTORS: 'xroad',
    JWT_ISSUER: 'https://idp.example/realms/techma',
    JWKS_URL: 'https://idp.example/jwks',
    PROOF_JWKS_URL: 'https://backend.example/jwks',
    OIDC_TOKEN_URL: 'https://idp.example/token',
    TOOLING_RESOURCES_CLIENT_ID: 'tooling-resources',
    TOOLING_RESOURCES_CLIENT_SECRET: 's1',
    TOOLING_EVENTS_CLIENT_ID: 'tooling-events',
    TOOLING_EVENTS_CLIENT_SECRET: 's2',
    TOOLING_XROAD_CLIENT_ID: 'tooling-xroad',
    TOOLING_XROAD_CLIENT_SECRET: 's3',
    TOOLING_DOCUMENTS_CLIENT_ID: 'tooling-documents',
    TOOLING_DOCUMENTS_CLIENT_SECRET: 's4',
  };
  const config = loadConfig(production);
  assert.deepEqual(config.connectors.enabled, ['xroad']);
  assert.equal(config.jwt?.clients['tooling-xroad']?.scope, 'xroad:apply');
  assert.equal(config.jwt?.clients['tooling-documents']?.scope, 'documents:transfer');
  assert.throws(() => loadConfig({ ...production, TOOLING_DOCUMENTS_CLIENT_SECRET: undefined }), ConfigError, 'identité documents requise avec le X-Road');
});
