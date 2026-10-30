import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

async function stack(t: TestContext, env: NodeJS.ProcessEnv = {}, simEnv: NodeJS.ProcessEnv = {}) {
  const backend = await startBackendMock(t);
  const sim = await startXroadSim(t, simEnv);
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

const FILED = new Set(['submitted', 'processing', 'blocked', 'completed', 'rejected']);

function assertBackendAccepts(item: any): void {
  assertSchema('DepartmentRequest', item);
  if (FILED.has(item.status)) assert.ok(item.submittedAt && item.receiptRef, `accusé de dépôt requis (${item.status})`);
  if (item.status === 'blocked') assert.ok(item.blocking, 'motif de blocage requis');
  if (item.status === 'completed') assert.ok(item.completedAt && item.completedBy, 'preuve de complétion requise');
  if (item.progress) assert.ok(item.progress.step <= item.progress.total);
  if (item.payment?.status === 'paid') assert.ok(item.payment.reference, 'référence de paiement requise');
  assert.equal(item.simulation, true);
}

const snapshots = async (s: Awaited<ReturnType<typeof stack>>, requestId: string) => {
  const rows = await s.db.transaction('system', (tx) =>
    tx.query<{ event: any }>(
      "select event from outbox where event->>'type' = 'bj.techma.request.snapshot.v1' and event->'data'->'request'->>'id' = $1 order by seq",
      [requestId],
    ),
  );
  const items = rows.map(({ event }) => {
    assertSchema('Event', event);
    assertBackendAccepts(event.data.request);
    return event.data as { action: string; actorRef?: string; request: any };
  });
  items.forEach((item, index) => assert.equal(item.request.revision, index + 1, 'révisions strictement croissantes'));
  return items;
};

const legacyEvents = async (s: Awaited<ReturnType<typeof stack>>) =>
  (
    await s.db.transaction('system', (tx) =>
      tx.query<{ n: number }>("select count(*)::int as n from outbox where event->>'type' in ('bj.techma.request.created.v1', 'bj.techma.request.status_changed.v1')"),
    )
  )[0].n;

async function command(s: Awaited<ReturnType<typeof stack>>, requestId: string, body: Record<string, unknown>, options: { key?: string | null; token?: string } = {}) {
  const res = await fetch(`${s.url}/internal/v1/admin/requests/${requestId}/actions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${options.token ?? 'mock-backend-admin'}`,
      traceparent: TRACEPARENT,
      'Content-Type': 'application/json',
      ...(options.key === null ? {} : { 'Idempotency-Key': options.key ?? randomUUID() }),
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as any };
}

const latest = async (s: Awaited<ReturnType<typeof stack>>, requestId: string) => (await snapshots(s, requestId)).at(-1)!.request;

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

test('parcours complet : relevé de notes payé, complété par l’assistant, document transmis, un snapshot par changement', async (t) => {
  const s = await stack(t);
  const r = await prepare(s, 'releve-notes', { session: 2012 }, ['piece-identite']);
  assert.equal((await r.row()).submission_state, 'queued');

  const early = await act(s.url, 'request.pay', { requestId: r.requestId }, { mandateId: r.mandateId });
  assert.match(toolError(early).detail, /en cours de transmission/);

  assert.equal(await s.worker.tick(), 1);
  const sent = await r.status();
  assert.equal(sent.status, 'submitted');
  assertSchema('Request', sent);
  const stored = await r.row();
  assert.match(stored.external_ref, /^cas_/);
  assert.match(stored.receipt.reference, /^SIM-ENS-2026-\d{6}$/);
  const filed = await latest(s, r.requestId);
  assert.equal(filed.administrationId, 'enseignement');
  assert.equal(filed.receiptRef, stored.receipt.reference);
  assert.deepEqual(filed.payment, { status: 'pending', amountFcfa: 1000, currency: 'XOF' });
  assert.ok(Date.parse(filed.dueAt) > Date.parse(filed.submittedAt));

  const key = randomUUID();
  const paid = await act(s.url, 'request.pay', { requestId: r.requestId }, { mandateId: r.mandateId, key });
  assert.equal(paid.isError, undefined, paid.content[0].text);
  assert.equal(paid.structuredContent!.status, 'paid');
  assert.equal(paid.structuredContent!.paymentReference, `SIM-PAY-${stored.receipt.reference.slice(-6)}`);
  const replay = await act(s.url, 'request.pay', { requestId: r.requestId }, { mandateId: r.mandateId, key });
  assert.deepEqual(replay.structuredContent, paid.structuredContent, 'rejeu à l’identique');
  const again = await act(s.url, 'request.pay', { requestId: r.requestId }, { mandateId: r.mandateId });
  assert.equal(again.structuredContent!.paymentReference, paid.structuredContent!.paymentReference, 'jamais deux paiements');
  assert.equal((await r.status()).status, 'completed', 'le paiement fait avancer le dossier tout de suite');

  assert.equal(await s.worker.tick(), 1);
  assert.equal((await r.row()).submission_state, 'done');
  const all = await snapshots(s, r.requestId);
  assert.deepEqual(
    all.map((item) => `${item.action}:${item.request.status}`),
    [
      'request.created:draft',
      'request.updated:draft',
      'request.updated:ready',
      'request.validated:awaiting_user_validation',
      'request.submitted:submitted',
      'request.paid:completed',
      'request.documents_issued:completed',
    ],
  );
  const done = all.at(-1)!.request;
  assert.equal(done.completedBy, 'ai');
  assert.deepEqual(done.payment, { status: 'paid', amountFcfa: 1000, currency: 'XOF', reference: paid.structuredContent!.paymentReference });
  assert.equal(done.documents.length, 1);
  assert.match(done.documents[0].fileId, /^fil_/);
  assert.equal(done.documents[0].mimeType, 'application/pdf');
  assert.equal(done.documents[0].simulation, true);
  assert.deepEqual(done.evidence, [{ field: 'session', source: 'user', confirmed: true }]);
  assert.deepEqual(done.progress, { step: 5, total: 5, label: 'Démarche terminée' });
  assert.equal(await legacyEvents(s), 0, 'plus d’événement request.* hérité une fois les snapshots adoptés');
  assert.equal(await s.worker.tick(), 0, 'plus rien à suivre');

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
      'tooling-connector:connector.status:UPDATED',
    ],
  );
});

test('casier judiciaire : En attente pour la Justice, pris en charge, complément, reprise et approbation depuis la console', async (t) => {
  const s = await stack(t);
  const r = await prepare(s, 'casier-judiciaire', { motif: 'emploi' }, ['piece-identite']);
  await s.worker.tick();
  await act(s.url, 'request.pay', { requestId: r.requestId }, { mandateId: r.mandateId });
  assert.equal((await r.status()).status, 'blocked');
  const waiting = await latest(s, r.requestId);
  assert.equal(waiting.administrationId, 'justice');
  assert.equal(waiting.status, 'blocked');
  assert.equal(waiting.blocking.code, 'ADMINISTRATION_REVIEW');
  assert.match(waiting.blocking.detail, /^Nouvelle demande à vérifier/);
  assert.equal(waiting.assignedTo, null);
  const caseId = (await r.row()).external_ref as string;
  assert.deepEqual((await official(s.sim.url, 'GET', '/v1/cases?view=pending', JUSTICE_AGENT)).body.items.map((item: any) => item.id), [caseId]);
  assert.deepEqual((await official(s.sim.url, 'GET', '/v1/cases?view=pending', ENSEIGNEMENT_AGENT)).body.items, [], 'rien pour l’Enseignement');

  const actor = 'oidc|agent-justice-1';
  const base = { departmentId: 'justice', actorRef: actor };
  assert.equal((await command(s, r.requestId, { action: 'claim', revision: waiting.revision, ...base }, { token: 'mock-agent' })).status, 401);
  assert.equal((await command(s, r.requestId, { action: 'claim', revision: waiting.revision, ...base }, { key: null })).body.code, 'INVALID_REQUEST');
  assert.equal((await command(s, r.requestId, { action: 'claim', revision: waiting.revision })).status, 400, 'département et agent obligatoires');
  assert.equal((await command(s, r.requestId, { action: 'claim', revision: waiting.revision, departmentId: 'enseignement', actorRef: actor })).status, 404, 'autre ministère');
  assert.equal((await command(s, r.requestId, { action: 'claim', revision: waiting.revision - 1, ...base })).status, 409, 'révision dépassée');
  assert.equal((await command(s, `req_${'0'.repeat(26)}`, { action: 'claim', revision: 1, ...base })).status, 404);

  const key = randomUUID();
  const claimed = await command(s, r.requestId, { action: 'claim', revision: waiting.revision, ...base }, { key });
  assert.equal(claimed.status, 200, JSON.stringify(claimed.body));
  assertBackendAccepts(claimed.body);
  assert.equal(claimed.body.status, 'processing');
  assert.equal(claimed.body.assignedTo, actor);
  assert.equal(claimed.body.revision, waiting.revision + 1);
  const published = (await snapshots(s, r.requestId)).at(-1)!;
  assert.deepEqual(published.request, claimed.body, 'la réponse est exactement le snapshot publié');
  assert.equal(published.action, 'admin.claim');
  assert.equal(published.actorRef, actor);
  assert.deepEqual((await command(s, r.requestId, { action: 'claim', revision: waiting.revision, ...base }, { key })).body, claimed.body, 'rejeu');
  assert.equal((await command(s, r.requestId, { action: 'claim', revision: waiting.revision, reason: 'autre', ...base }, { key })).body.code, 'IDEMPOTENCY_CONFLICT');
  assert.equal((await command(s, r.requestId, { action: 'claim', revision: claimed.body.revision, ...base })).status, 409, 'déjà pris en charge');

  assert.equal((await command(s, r.requestId, { action: 'request_information', revision: claimed.body.revision, ...base })).status, 400, 'motif requis');
  const asked = await command(s, r.requestId, { action: 'request_information', revision: claimed.body.revision, reason: "Copie lisible de la pièce d'identité", ...base });
  assert.equal(asked.status, 200);
  assert.equal(asked.body.status, 'blocked');
  assert.deepEqual({ ...asked.body.blocking, at: undefined }, { code: 'INFORMATION_REQUESTED', detail: "Copie lisible de la pièce d'identité", at: undefined });
  await s.db.transaction('system', (tx) => tx.query('update requests set next_check_at = now() where id = $1', [r.requestId]));
  await s.worker.tick();
  assert.equal((await latest(s, r.requestId)).revision, asked.body.revision, 'le suivi ne défait pas la demande de complément');
  assert.equal((await r.status()).status, 'blocked');

  const resumed = await command(s, r.requestId, { action: 'resume', revision: asked.body.revision, ...base });
  assert.equal(resumed.body.status, 'processing');
  assert.equal(resumed.body.blocking, undefined);
  const approved = await command(s, r.requestId, { action: 'approve', revision: resumed.body.revision, reason: 'Identité confirmée', ...base });
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  assertBackendAccepts(approved.body);
  assert.equal(approved.body.status, 'completed');
  assert.equal(approved.body.completedBy, 'human');
  const decided = s.sim.store.getCase({ kind: 'applicant', applicantRef: USER_REF }, caseId);
  assert.equal(decided.completedBy, 'administration');
  assert.match(decided.steps.find((step: any) => step.id === 'check').note, /console d'administration/);
  assert.equal((await r.status()).status, 'completed', 'l’usager voit la décision');

  assert.equal(await s.worker.tick(), 1);
  const final = await latest(s, r.requestId);
  assert.equal(final.documents.length, 1, 'extrait de casier transmis au Backend');
  assert.equal((await r.row()).submission_state, 'done');
  assert.equal((await command(s, r.requestId, { action: 'claim', revision: final.revision, ...base })).status, 409, 'dossier clos');

  const audit = await s.db.transaction('system', (tx) =>
    tx.query<{ action: string; outcome: string; code: string }>("select action, outcome, code from audit_log where actor = 'backend-admin' order by id"),
  );
  assert.deepEqual(
    audit.filter((entry) => entry.outcome === 'success').map((entry) => `${entry.action}:${entry.code}`),
    ['admin.claim:OK', 'admin.claim:REPLAY', 'admin.request_information:OK', 'admin.resume:OK', 'admin.approve:OK'],
  );
  assert.ok(audit.some((entry) => entry.code === 'IDEMPOTENCY_CONFLICT'));
  assert.equal(await legacyEvents(s), 0);
});

test('rejet depuis la console : dossier rejeté, sans document, suivi terminé', async (t) => {
  const s = await stack(t);
  const r = await prepare(s, 'certificat-nationalite', { motif: 'passeport' }, ['acte-naissance', 'piece-identite']);
  await s.worker.tick();
  const early = await latest(s, r.requestId);
  assert.equal(
    (await command(s, r.requestId, { action: 'approve', revision: early.revision, departmentId: 'justice', actorRef: 'agent-2' })).status,
    409,
    'pas de décision avant le paiement',
  );
  await act(s.url, 'request.pay', { requestId: r.requestId }, { mandateId: r.mandateId });
  const waiting = await latest(s, r.requestId);
  assert.equal(waiting.blocking.code, 'ADMINISTRATION_REVIEW');
  const rejected = await command(s, r.requestId, { action: 'reject', revision: waiting.revision, reason: 'Filiation non établie', departmentId: 'justice', actorRef: 'agent-2' });
  assert.equal(rejected.status, 200, JSON.stringify(rejected.body));
  assertBackendAccepts(rejected.body);
  assert.equal(rejected.body.status, 'rejected');
  assert.deepEqual(rejected.body.documents, []);
  assert.equal(await s.worker.tick(), 1);
  assert.equal((await r.row()).submission_state, 'done');
  assert.equal((await r.status()).status, 'rejected');
});

test('X-Road redémarré : dossiers conservés dans son fichier d’état, le suivi reprend sans échec', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'xroad-tooling-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const s = await stack(t, {}, { XROAD_STATE_FILE: join(dir, 'state.json') });
  const r = await prepare(s, 'casier-judiciaire', { motif: 'voyage' }, ['piece-identite']);
  await s.worker.tick();
  await s.sim.restart();
  const paid = await act(s.url, 'request.pay', { requestId: r.requestId }, { mandateId: r.mandateId });
  assert.equal(paid.isError, undefined, paid.content[0].text);
  await s.worker.tick();
  const stored = await r.row();
  assert.equal(stored.submission_state, 'sent');
  assert.equal(stored.connector_error, null);
  assert.equal((await r.status()).status, 'blocked');
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
  assert.equal(config.jwt?.clients['tooling-xroad']?.scope, 'xroad:read xroad:submit xroad:decide');
  assert.equal(config.jwt?.clients['tooling-documents']?.scope, 'documents:transfer');
  assert.throws(() => loadConfig({ ...production, TOOLING_DOCUMENTS_CLIENT_SECRET: undefined }), ConfigError, 'identité documents requise avec le X-Road');
});
