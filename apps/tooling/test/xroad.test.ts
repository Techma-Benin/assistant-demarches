import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test, type TestContext } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ConfigError, loadConfig } from '../src/config.js';
import { ConnectorWorker } from '../src/connectors/connector-worker.js';
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
  toolError,
  uploadFile,
} from './helpers.js';

const JUSTICE_AGENT = `off_01JC${'0'.repeat(20)}11`;
const ENSEIGNEMENT_AGENT = `off_01JC${'0'.repeat(20)}15`;

async function official(simUrl: string, method: string, path: string, officialId: string, body?: unknown) {
  const res = await fetch(`${simUrl}${path}`, {
    method,
    headers: {
      Authorization: 'Bearer mock-backend-xroad',
      traceparent: TRACEPARENT,
      'X-Official-Id': officialId,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as any };
}

async function stack(t: TestContext, env: NodeJS.ProcessEnv = {}) {
  const backend = await startBackendMock(t);
  const sim = await startXroadSim(t);
  const tooling = await startToolingApp(t, {
    AUTH_MODE: 'mock-tokens',
    BACKEND_URL: backend,
    XROAD_URL: sim.url,
    CONNECTORS: 'xroad',
    CONNECTOR_WORKER: 'off',
    CONNECTOR_POLL_MS: '20',
    ...env,
  });
  return { backend, sim, ...tooling, worker: tooling.app.get(ConnectorWorker) };
}

/** Consent, then the request filled and prepared with the agent's tools, as in a conversation. */
async function prepare(s: Awaited<ReturnType<typeof stack>>, procedureId: string, fields: Record<string, unknown>, documentTypes: string[]) {
  const { body } = await grantMandate(s.url, { procedureId });
  const mandateId = body.id as string;
  const created = await act(s.url, 'request.create', { procedureId }, { mandateId });
  const requestId = created.structuredContent!.id as string;
  await act(s.url, 'request.update', { requestId, fields }, { mandateId });
  for (const documentType of documentTypes) {
    const attached = await act(s.url, 'documents.attach', { requestId, fileId: await uploadFile(s.backend), documentType }, { mandateId });
    assert.equal(attached.isError, undefined, attached.content[0].text);
  }
  const submitted = await act(s.url, 'request.submit', { requestId }, { mandateId });
  assert.equal(submitted.structuredContent!.status, 'awaiting_user_validation', submitted.content[0].text);
  const status = async () => (await act(s.url, 'request.status', { requestId })).structuredContent!;
  const row = async () =>
    (
      await s.db.transaction('system', (tx) =>
        tx.query<Record<string, any>>('select status, submission_state, connector_error, external_ref, receipt from requests where id = $1', [requestId]),
      )
    )[0];
  return { mandateId, requestId, status, row };
}

const statusChanges = async (s: Awaited<ReturnType<typeof stack>>, requestId: string) =>
  (
    await s.db.transaction('system', (tx) =>
      tx.query<{ event: any }>("select event from outbox where event->>'type' = 'bj.techma.request.status_changed.v1' and event->'data'->>'requestId' = $1 order by seq", [requestId]),
    )
  ).map(({ event }) => {
    assertSchema('Event', event);
    return `${event.data.from}>${event.data.to}`;
  });

test('catalogue : les fiches viennent du X-Road simulé, avec frais et administration', async (t) => {
  const s = await stack(t);
  const client = await mcpClient(t, s.url, 'mock-agent');
  const search = await callTool(client, 'procedures.search', { query: 'casier', locale: 'fr' });
  const items = search.structuredContent!.items as any[];
  assert.deepEqual(items.map((item) => item.id), ['casier-judiciaire']);
  assert.equal(items[0].administrationId, 'justice');
  assert.equal(items[0].feeFcfa, 1000);
  const procedure = await callTool(client, 'procedures.get', { procedureId: 'certificat-nationalite' });
  assertSchema('Procedure', procedure.structuredContent);
  assert.equal(toolError(await callTool(client, 'procedures.get', { procedureId: 'demo-procedure' })).code, 'NOT_FOUND', 'plus de fiche Backend');
});

test('parcours complet : dépôt au X-Road, paiement simulé, dossier complété par l’assistant', async (t) => {
  const s = await stack(t);
  const r = await prepare(s, 'casier-judiciaire', { motif: 'emploi' }, ['piece-identite']);
  assert.equal((await r.row()).submission_state, 'queued');

  const early = await act(s.url, 'request.pay', { requestId: r.requestId }, { mandateId: r.mandateId });
  assert.match(toolError(early).detail, /en cours de transmission/);

  assert.equal(await s.worker.tick(), 1);
  const sent = await r.status();
  assert.equal(sent.status, 'submitted');
  assertSchema('Request', sent);
  const stored = await r.row();
  assert.match(stored.external_ref, /^cas_/);
  assert.match(stored.receipt.reference, /^SIM-JUS-2026-\d{6}$/);

  // The case really lives in the simulated administration, routed to Justice, for this applicant.
  const filed = s.sim.store.getCase({ kind: 'applicant', applicantRef: USER_REF }, stored.external_ref);
  assert.equal(filed.administrationId, 'justice');
  assert.equal(filed.requestId, r.requestId);
  assert.deepEqual(filed.fields, { motif: 'emploi' });
  assert.equal(filed.status, 'awaiting_payment');

  const key = randomUUID();
  const paid = await act(s.url, 'request.pay', { requestId: r.requestId }, { mandateId: r.mandateId, key });
  assert.equal(paid.isError, undefined, paid.content[0].text);
  assert.deepEqual({ ...paid.structuredContent, paidAt: undefined }, {
    requestId: r.requestId,
    caseReference: stored.receipt.reference,
    simulated: true,
    amountFcfa: 1000,
    status: 'paid',
    paymentReference: `SIM-PAY-${stored.receipt.reference.slice(-6)}`,
    paidAt: undefined,
  });
  const replay = await act(s.url, 'request.pay', { requestId: r.requestId }, { mandateId: r.mandateId, key });
  assert.deepEqual(replay.structuredContent, paid.structuredContent, 'rejeu à l’identique');
  const again = await act(s.url, 'request.pay', { requestId: r.requestId }, { mandateId: r.mandateId });
  assert.equal(again.structuredContent!.paymentReference, paid.structuredContent!.paymentReference, 'jamais deux paiements');

  // Paying asked the worker to look again at once: the status comes back without waiting for the poll interval.
  assert.equal(await s.worker.tick(), 1);
  assert.equal((await r.status()).status, 'completed');
  assert.equal((await r.row()).submission_state, 'done');
  assert.deepEqual(await statusChanges(s, r.requestId), ['draft>ready', 'ready>awaiting_user_validation', 'awaiting_user_validation>submitted', 'submitted>completed']);
  assert.equal(s.sim.store.getCase({ kind: 'applicant', applicantRef: USER_REF }, stored.external_ref).completedBy, 'assistant');

  const audit = await s.db.transaction('system', (tx) =>
    tx.query<{ actor: string; action: string; code: string }>('select actor, action, code from audit_log where request_id = $1 order by id', [r.requestId]),
  );
  assert.deepEqual(
    audit.filter((entry) => entry.action.startsWith('connector') || entry.action === 'request.pay').map((entry) => `${entry.actor}:${entry.action}:${entry.code}`),
    [
      'backend-agent:request.pay:INVALID_TRANSITION',
      'tooling-connector:connector.submit:OK',
      'backend-agent:request.pay:OK',
      'backend-agent:request.pay:REPLAY',
      'backend-agent:request.pay:OK',
      'tooling-connector:connector.status:COMPLETED',
    ],
  );
});

test('dossier bloqué : en attente au ministère, décision d’un agent, puis completed côté usager', async (t) => {
  const s = await stack(t);
  const r = await prepare(s, 'certificat-nationalite', { motif: 'passeport' }, ['acte-naissance', 'piece-identite']);
  await s.worker.tick();
  await act(s.url, 'request.pay', { requestId: r.requestId }, { mandateId: r.mandateId });
  await s.worker.tick();
  assert.equal((await r.status()).status, 'processing');
  const caseId = (await r.row()).external_ref as string;

  const pending = await official(s.sim.url, 'GET', '/v1/cases?view=pending', JUSTICE_AGENT);
  assert.deepEqual(pending.body.items.map((item: any) => item.id), [caseId]);
  assert.equal(pending.body.items[0].steps.find((step: any) => step.state === 'blocked').actor, 'assistant');
  assert.deepEqual((await official(s.sim.url, 'GET', '/v1/cases?view=pending', ENSEIGNEMENT_AGENT)).body.items, [], 'autre ministère : rien');

  const decided = await official(s.sim.url, 'POST', `/v1/cases/${caseId}/decisions`, JUSTICE_AGENT, { decision: 'approve', note: 'Filiation confirmée' });
  assert.equal(decided.body.status, 'completed');
  await s.db.transaction('system', (tx) => tx.query('update requests set next_check_at = now() where id = $1', [r.requestId]));
  await s.worker.tick();
  assert.equal((await r.status()).status, 'completed');
  assert.deepEqual((await statusChanges(s, r.requestId)).slice(-3), ['awaiting_user_validation>submitted', 'submitted>processing', 'processing>completed']);
});

test('paiement refusé sans mandat valide : aucun argent ne bouge au X-Road', async (t) => {
  const s = await stack(t);
  const r = await prepare(s, 'casier-judiciaire', { motif: 'voyage' }, ['piece-identite']);
  await s.worker.tick();
  assert.equal((await postInternal(s.url, `/internal/v1/mandates/${r.mandateId}/revoke`, undefined)).status, 200);
  const refused = await act(s.url, 'request.pay', { requestId: r.requestId }, { mandateId: r.mandateId });
  assert.equal(toolError(refused).code, 'MANDATE_REVOKED');
  const other = await act(s.url, 'request.pay', { requestId: r.requestId }, { mandateId: r.mandateId, userRef: `usr_${'0'.repeat(25)}9` });
  assert.equal(toolError(other).code, 'NOT_FOUND', 'demande d’un autre usager');
  const filed = s.sim.store.getCase({ kind: 'applicant', applicantRef: USER_REF }, (await r.row()).external_ref);
  assert.equal(filed.payment.status, 'pending');
  assert.equal(filed.status, 'awaiting_payment');
});

test('refus définitif de l’administration : abandon immédiat, lien officiel conservé', async (t) => {
  const s = await stack(t);
  const r = await prepare(s, 'authentification-diplome', { session: 2010, examen: 'BAC' }, ['diplome']);
  // The administration already holds a case for this request: filing it again is refused for good.
  s.sim.store.createCase(USER_REF, { requestId: r.requestId, procedureId: 'authentification-diplome', fields: { session: 2010, examen: 'BAC' }, documents: [{ documentType: 'diplome', fileId: `fil_${'0'.repeat(25)}1`, mimeType: 'application/pdf', sizeBytes: 1 }] });
  await s.worker.tick();
  const stored = await r.row();
  assert.equal(stored.submission_state, 'failed');
  assert.equal(stored.connector_error, 'INVALID_TRANSITION');
  const after = await r.status();
  assert.equal(after.status, 'awaiting_user_validation');
  assert.match(String(after.officialLink), /^https:\/\/example\.org\/xroad-simulation\//);
  assert.equal(await s.worker.tick(), 0, 'plus de nouvel essai');
});

test('X-Road injoignable : nouvel essai différé, rien d’inventé', async (t) => {
  const s = await stack(t);
  const r = await prepare(s, 'casier-judiciaire', { motif: 'emploi' }, ['piece-identite']);
  await s.sim.close();
  await s.worker.tick();
  const stored = await r.row();
  assert.equal(stored.submission_state, 'queued');
  assert.equal(stored.connector_error, 'UPSTREAM_UNAVAILABLE');
  assert.equal((await r.status()).status, 'awaiting_user_validation');
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

test('configuration : connecteur xroad lié au X-Road, admis hors poste local', () => {
  const local = loadConfig({ AUTH_MODE: 'mock-tokens', XROAD_URL: 'http://127.0.0.1:4040', CONNECTORS: 'xroad' });
  assert.equal(local.procedureSource, 'xroad');
  assert.deepEqual(local.connectors.enabled, ['xroad']);
  assert.equal(loadConfig({ AUTH_MODE: 'mock-tokens' }).procedureSource, 'backend');
  assert.throws(() => loadConfig({ AUTH_MODE: 'mock-tokens', CONNECTORS: 'xroad' }), ConfigError);
  assert.throws(() => loadConfig({ AUTH_MODE: 'mock-tokens', PROCEDURES_SOURCE: 'xroad' }), ConfigError);
  assert.throws(() => loadConfig({ AUTH_MODE: 'mock-tokens', XROAD_URL: 'http://127.0.0.1:4040', PROCEDURES_SOURCE: 'backend', CONNECTORS: 'xroad' }), ConfigError);
  assert.throws(() => loadConfig({ AUTH_MODE: 'mock-tokens', XROAD_URL: 'http://10.0.0.5:4040' }), ConfigError, 'HTTPS hors localhost');

  const production = loadConfig({
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
  });
  assert.deepEqual(production.connectors.enabled, ['xroad']);
  assert.equal(production.jwt?.clients['tooling-xroad']?.scope, 'xroad:read xroad:submit');
});
