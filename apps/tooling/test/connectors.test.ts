import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { ConfigError, loadConfig } from '../src/config.js';
import { SimulatedConnector } from '../src/connectors/connector.js';
import { ConnectorWorker } from '../src/connectors/connector-worker.js';
import { act, assertSchema, grantMandate, postInternal, startBackendMock, startToolingApp, uploadFile } from './helpers.js';

const CONTRACT_KEYS = ['conversationId', 'fields', 'fileIds', 'id', 'officialLink', 'procedureId', 'status', 'updatedAt', 'userRef'];
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function setup(t: TestContext, env: NodeJS.ProcessEnv = { CONNECTORS: 'simulated' }) {
  const backend = await startBackendMock(t);
  const tooling = await startToolingApp(t, { AUTH_MODE: 'mock-tokens', BACKEND_URL: backend, CONNECTOR_WORKER: 'off', CONNECTOR_POLL_MS: '20', CONNECTOR_SIMULATED_STEP_MS: '150', ...env });
  const { body } = await grantMandate(tooling.url);
  const mandateId = body.id as string;
  const created = await act(tooling.url, 'request.create', { procedureId: 'demo-procedure' }, { mandateId });
  const requestId = created.structuredContent!.id as string;
  await act(tooling.url, 'request.update', { requestId, fields: { displayName: 'Usager fictif' } }, { mandateId });
  await act(tooling.url, 'documents.attach', { requestId, fileId: await uploadFile(backend), documentType: 'demo-document' }, { mandateId });
  const submitted = await act(tooling.url, 'request.submit', { requestId }, { mandateId });
  const worker = tooling.app.get(ConnectorWorker);
  const status = async () => (await act(tooling.url, 'request.status', { requestId })).structuredContent!;
  const row = async () =>
    (await tooling.db.transaction('system', (tx) => tx.query<Record<string, unknown>>('select submission_state, connector_error, external_ref, receipt from requests where id = $1', [requestId])))[0];
  return { ...tooling, mandateId, requestId, submitted, worker, status, row };
}

test('connecteur : envoi avec accusé de réception, puis suivi jusqu’à completed', async (t) => {
  const s = await setup(t, { CONNECTORS: 'simulated', CONNECTOR_SIMULATED_STEP_MS: '60000' });
  const sentAgo = (ms: number) =>
    s.db.transaction('system', (tx) =>
      tx.query("update requests set external_ref = regexp_replace(external_ref, '-[0-9]+$', '-' || $2::text), next_check_at = now() where id = $1", [
        s.requestId,
        String(Date.now() - ms),
      ]),
    );
  assert.equal(s.submitted.structuredContent!.status, 'awaiting_user_validation');
  assert.equal((await s.row()).submission_state, 'queued');

  assert.equal(await s.worker.tick(), 1);
  const sent = await s.status();
  assert.equal(sent.status, 'submitted');
  assertSchema('Request', sent);
  assert.deepEqual(Object.keys(sent).sort(), CONTRACT_KEYS.sort(), 'aucun champ hors contrat, accusé compris');
  const stored = await s.row();
  assert.match(String(stored.external_ref), /^SIMULATION-req_/);
  assert.match(String((stored.receipt as { reference: string }).reference), /^SIMULATION-/);

  await sentAgo(90_000);
  await s.worker.tick();
  assert.equal((await s.status()).status, 'processing');
  await sentAgo(150_000);
  await s.worker.tick();
  assert.equal((await s.status()).status, 'completed');
  assert.equal((await s.row()).submission_state, 'done');
  await pause(40);
  assert.equal(await s.worker.tick(), 0, 'plus de suivi après un état final');

  const events = await s.db.transaction('system', (tx) =>
    tx.query<{ event: { data: { from: string; to: string } } }>("select event from outbox where event->>'type' = 'bj.techma.request.status_changed.v1' order by seq"),
  );
  events.forEach(({ event }) => assertSchema('Event', event));
  assert.deepEqual(
    events.map(({ event }) => `${event.data.from}>${event.data.to}`).slice(-3),
    ['awaiting_user_validation>submitted', 'submitted>processing', 'processing>completed'],
  );
  const audit = await s.db.transaction('system', (tx) => tx.query<{ action: string; actor: string; code: string }>("select action, actor, code from audit_log where actor = 'tooling-connector' order by id"));
  assert.deepEqual(
    audit.map((entry) => `${entry.action}:${entry.code}`),
    ['connector.submit:OK', 'connector.status:PROCESSING', 'connector.status:COMPLETED'],
  );
  const late = await act(s.url, 'request.update', { requestId: s.requestId, fields: { displayName: 'Autre' } }, { mandateId: s.mandateId });
  assert.equal(JSON.parse(late.content[0].text).code, 'INVALID_TRANSITION');
});

test('sans connecteur : comportement v1 inchangé, rien n’est envoyé', async (t) => {
  const s = await setup(t, {});
  assert.equal(s.submitted.structuredContent!.status, 'awaiting_user_validation');
  assert.equal(s.submitted.structuredContent!.officialLink, 'https://example.org/demonstration');
  assert.equal((await s.row()).submission_state, null);
  assert.equal(await s.worker.tick(), 0);
  assert.equal((await s.status()).status, 'awaiting_user_validation');
});

test('mandat révoqué avant l’envoi : rien n’est transmis, le lien officiel reste', async (t) => {
  const s = await setup(t);
  assert.equal((await postInternal(s.url, `/internal/v1/mandates/${s.mandateId}/revoke`, undefined)).status, 200);
  await s.worker.tick();
  const after = await s.status();
  assert.equal(after.status, 'awaiting_user_validation');
  assert.equal(after.officialLink, 'https://example.org/demonstration');
  const stored = await s.row();
  assert.equal(stored.submission_state, 'withdrawn');
  assert.equal(stored.external_ref, null);
});

test('panne du connecteur : nouvel essai différé, puis envoi réussi', async (t) => {
  const s = await setup(t);
  const connector = s.app.get(SimulatedConnector);
  const submit = connector.submit.bind(connector);
  connector.submit = async () => {
    throw new Error('portail indisponible');
  };
  await s.worker.tick();
  assert.equal((await s.status()).status, 'awaiting_user_validation');
  const failed = await s.row();
  assert.equal(failed.submission_state, 'queued');
  assert.equal(failed.connector_error, 'UPSTREAM_UNAVAILABLE');
  assert.equal(await s.worker.tick(), 0, 'pas de nouvel essai avant le délai');

  connector.submit = submit;
  await s.db.transaction('system', (tx) => tx.query('update requests set next_check_at = now() where id = $1', [s.requestId]));
  await s.worker.tick();
  assert.equal((await s.status()).status, 'submitted');
  assert.equal((await s.row()).connector_error, null);
});

test('connecteur simulé : refusé hors du poste local et en production, nom inconnu refusé', () => {
  assert.deepEqual(loadConfig({ AUTH_MODE: 'mock-tokens', CONNECTORS: 'simulated' }).connectors.enabled, ['simulated']);
  assert.deepEqual(loadConfig({ AUTH_MODE: 'mock-tokens' }).connectors.enabled, []);
  assert.throws(() => loadConfig({ AUTH_MODE: 'mock-tokens', CONNECTORS: 'portail-anip' }), ConfigError);
  assert.throws(() => loadConfig({ AUTH_MODE: 'mock-tokens', CONNECTORS: 'simulated', TOOLING_HOST: '0.0.0.0' }), ConfigError);
  assert.throws(() => loadConfig({ NODE_ENV: 'production', CONNECTORS: 'simulated', DATABASE_URL: 'postgres://u:p@db/t', BACKEND_URL: 'https://b' }), ConfigError);
});
