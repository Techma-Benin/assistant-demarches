import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConfigError, loadConfig } from '../src/config.js';
import { act, grantMandate, startBackendMock, startToolingApp, startXroadSim, toFields, toolError, uploadFile } from './helpers.js';

test('sans X-Road : le dépôt est refusé, rien n’est inventé', async (t) => {
  const backend = await startBackendMock(t);
  const { url } = await startToolingApp(t, { AUTH_MODE: 'mock-tokens', BACKEND_URL: backend });
  const { body } = await grantMandate(url);
  const mandateId = body.id as string;
  const created = await act(url, 'request.create', { procedureId: 'PS00373' }, { mandateId });
  const requestId = created.structuredContent!.id as string;
  await act(url, 'request.update', { requestId, fields: toFields({ adresseDomicile: 'Cotonou', profession: 'Comptable', nombreEnfantsACharge: 2, situationMatrimoniale: 'Marié' }) }, { mandateId });
  await act(url, 'documents.attach', { requestId, fileId: await uploadFile(backend), documentType: 'extrait-acte-naissance' }, { mandateId });
  assert.equal(toolError(await act(url, 'request.submit', { requestId }, { mandateId })).code, 'UPSTREAM_UNAVAILABLE');
});

test('connecteur simulé : refusé hors du poste local et en production, nom inconnu refusé', () => {
  assert.deepEqual(loadConfig({ AUTH_MODE: 'mock-tokens', CONNECTORS: 'simulated' }).connectors.enabled, ['simulated']);
  assert.deepEqual(loadConfig({ AUTH_MODE: 'mock-tokens' }).connectors.enabled, []);
  assert.throws(() => loadConfig({ AUTH_MODE: 'mock-tokens', NODE_ENV: 'production', TOOLING_HOST: '0.0.0.0', CONNECTORS: 'simulated', DATABASE_URL: 'postgres://u:p@db/t', BACKEND_URL: 'https://backend.example', JWT_ISSUER: 'https://idp.example/realms/techma', JWKS_URL: 'https://idp.example/jwks', PROOF_JWKS_URL: 'https://backend.example/jwks', OIDC_TOKEN_URL: 'https://idp.example/token', TOOLING_RESOURCES_CLIENT_ID: 'r', TOOLING_RESOURCES_CLIENT_SECRET: 's', TOOLING_EVENTS_CLIENT_ID: 'e', TOOLING_EVENTS_CLIENT_SECRET: 's' }), ConfigError);
  assert.throws(() => loadConfig({ AUTH_MODE: 'mock-tokens', CONNECTORS: 'unknown' }), ConfigError);
});

test('X-Road : submit publie case.updated, le statut Request reste submitted', async (t) => {
  const backend = await startBackendMock(t);
  const sim = await startXroadSim(t);
  const { url, db } = await startToolingApp(t, { AUTH_MODE: 'mock-tokens', BACKEND_URL: backend, XROAD_URL: sim.url, CONNECTORS: 'xroad', CONNECTOR_WORKER: 'off' });
  const { body } = await grantMandate(url, { procedureId: 'PS00373' });
  const mandateId = body.id as string;
  const created = await act(url, 'request.create', { procedureId: 'PS00373' }, { mandateId });
  const requestId = created.structuredContent!.id as string;
  await act(url, 'request.update', { requestId, fields: toFields({ adresseDomicile: 'Cotonou', profession: 'Comptable', nombreEnfantsACharge: 2, situationMatrimoniale: 'Marié' }) }, { mandateId });
  await act(url, 'documents.attach', { requestId, fileId: await uploadFile(backend), documentType: 'extrait-acte-naissance' }, { mandateId });
  const submitted = await act(url, 'request.submit', { requestId }, { mandateId });
  assert.ok(!submitted.isError, submitted.content[0].text);
  assert.equal((submitted.structuredContent as { request: { status: string } }).request.status, 'submitted');
  const types = await db.transaction('system', (tx) => tx.query<{ type: string }>("select event->>'type' as type from outbox"));
  assert.ok(types.some((row) => row.type === 'bj.techma.case.updated.v2'));
  assert.equal(toolError(await act(url, 'request.update', { requestId, fields: toFields({ profession: 'Autre' }) }, { mandateId })).code, 'INVALID_TRANSITION');
});
