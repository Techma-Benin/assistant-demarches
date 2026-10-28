import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import {
  act,
  assertSchema,
  challenge,
  CONVERSATION_ID,
  fakeId,
  grantMandate,
  postInternal,
  startBackendMock,
  startFakeOidc,
  startToolingApp,
  toolError,
  uploadFile,
  USER_REF,
} from './helpers.js';

const OTHER_USER = `usr_${'0'.repeat(25)}2`;

async function setup(t: Parameters<typeof startToolingApp>[0], env: NodeJS.ProcessEnv = {}) {
  const backend = await startBackendMock(t);
  const tooling = await startToolingApp(t, { AUTH_MODE: 'mock-tokens', BACKEND_URL: backend, ...env });
  return { backend, ...tooling };
}

test('parcours complet : mandat → demande → pièce → lien officiel, puis révocation', async (t) => {
  const { backend, url } = await setup(t);
  assert.equal(toolError(await act(url, 'request.create', { procedureId: 'demo-procedure' })).code, 'MANDATE_MISSING');

  const granted = await grantMandate(url);
  assert.equal(granted.status, 201);
  assertSchema('Mandate', granted.body);
  const mandateId = granted.body.id as string;
  const options = { mandateId };

  const key = randomUUID();
  const created = await act(url, 'request.create', { procedureId: 'demo-procedure' }, { ...options, key });
  assert.ok(!created.isError, created.content[0].text);
  const request = created.structuredContent!;
  assertSchema('Request', request);
  assert.equal(request.status, 'draft');
  assert.deepEqual((await act(url, 'request.create', { procedureId: 'demo-procedure' }, { ...options, key })).structuredContent, request);
  assert.equal(toolError(await act(url, 'request.create', { procedureId: 'other' }, { ...options, key })).code, 'IDEMPOTENCY_CONFLICT');

  const requestId = request.id as string;
  assert.equal(toolError(await act(url, 'request.submit', { requestId }, options)).code, 'REQUEST_INCOMPLETE');
  assert.equal(toolError(await act(url, 'request.update', { requestId, fields: { npi: 'must-not-pass' } }, options)).code, 'INVALID_REQUEST');
  assert.equal(toolError(await act(url, 'request.update', { requestId, fields: { unknown: 'x' } }, options)).code, 'INVALID_REQUEST');
  const updated = await act(url, 'request.update', { requestId, fields: { displayName: 'Usager fictif' } }, options);
  assert.equal(updated.structuredContent!.status, 'draft');

  const fileId = await uploadFile(backend);
  assert.equal(toolError(await act(url, 'documents.attach', { requestId, fileId, documentType: 'unknown-type' }, options)).code, 'INVALID_REQUEST');
  const attached = await act(url, 'documents.attach', { requestId, fileId, documentType: 'demo-document' }, options);
  assert.equal(attached.structuredContent!.status, 'ready');
  assert.deepEqual(attached.structuredContent!.fileIds, [fileId]);
  const verified = await act(url, 'documents.verify', { requestId, fileId });
  assert.deepEqual(verified.structuredContent, { fileId, status: 'valid', reasons: [] });

  const submitted = await act(url, 'request.submit', { requestId }, options);
  assert.equal(submitted.structuredContent!.status, 'awaiting_user_validation');
  assert.equal(submitted.structuredContent!.officialLink, 'https://example.org/demonstration');
  assert.equal(toolError(await act(url, 'request.update', { requestId, fields: { displayName: 'Autre' } }, options)).code, 'INVALID_TRANSITION');

  const revoked = await postInternal(url, `/internal/v1/mandates/${mandateId}/revoke`, undefined);
  assert.equal(revoked.status, 200);
  assert.equal(revoked.body.status, 'revoked');
  assert.equal(toolError(await act(url, 'request.create', { procedureId: 'demo-procedure' }, options)).code, 'MANDATE_REVOKED');

  assert.ok(!(await act(url, 'request.status', { requestId })).isError);
  assert.equal(toolError(await act(url, 'request.status', { requestId }, { conversationId: fakeId('cnv') })).code, 'NOT_FOUND');
  assert.equal(toolError(await act(url, 'request.status', { requestId }, { userRef: OTHER_USER })).code, 'NOT_FOUND');
});

test('mandat : portée, propriétaire, démarche et expiration contrôlés à chaque action', async (t) => {
  const { url, db } = await setup(t);
  const limited = await grantMandate(url, { scopes: ['requests:write'] });
  const created = await act(url, 'request.create', { procedureId: 'demo-procedure' }, { mandateId: limited.body.id as string });
  assert.ok(!created.isError);
  const requestId = created.structuredContent!.id as string;
  assert.equal(toolError(await act(url, 'request.submit', { requestId }, { mandateId: limited.body.id as string })).code, 'MANDATE_SCOPE_DENIED');

  const elsewhere = await grantMandate(url, { conversationId: fakeId('cnv') });
  assert.equal(toolError(await act(url, 'request.create', { procedureId: 'demo-procedure' }, { mandateId: elsewhere.body.id as string })).code, 'MANDATE_SCOPE_DENIED');
  const foreign = await grantMandate(url, { userRef: OTHER_USER });
  assert.equal(toolError(await act(url, 'request.create', { procedureId: 'demo-procedure' }, { mandateId: foreign.body.id as string })).code, 'MANDATE_MISSING');

  const full = await grantMandate(url);
  await db.transaction('system', (tx) => tx.query("update mandates set expires_at = now() - interval '1 second' where id = $1", [full.body.id]));
  assert.equal(toolError(await act(url, 'request.create', { procedureId: 'demo-procedure' }, { mandateId: full.body.id as string })).code, 'MANDATE_EXPIRED');
});

test('contrôle des mandats : identité dédiée, challenge à usage unique, idempotence', async (t) => {
  const { url } = await setup(t);
  const body = { challenge: challenge(), acceptedAt: new Date().toISOString(), evidenceRef: 'proof_test' };
  const key = randomUUID();
  assert.equal((await postInternal(url, '/internal/v1/mandates', body, { token: 'mock-agent' })).status, 401);
  const first = await postInternal(url, '/internal/v1/mandates', body, { key });
  assert.equal(first.status, 201);
  assert.deepEqual(await postInternal(url, '/internal/v1/mandates', body, { key }), first);
  assert.equal((await postInternal(url, '/internal/v1/mandates', { ...body, evidenceRef: 'other' }, { key })).status, 409);
  const reused = await postInternal(url, '/internal/v1/mandates', body);
  assert.equal(reused.status, 403);
  assertSchema('Problem', reused.body);

  const expired = await grantMandate(url, { expiresAt: new Date(Date.now() - 1000).toISOString() });
  assert.equal(expired.body.code, 'MANDATE_EXPIRED');
  assert.equal((await grantMandate(url, { scopes: [] })).status, 400);
  assert.equal((await postInternal(url, '/internal/v1/mandates', { ...body, extra: true })).status, 400);
  assert.equal((await postInternal(url, `/internal/v1/mandates/${fakeId('mdt')}/revoke`, undefined)).status, 404);
  assert.equal((await postInternal(url, '/internal/v1/mandates', body, { key: 'short' })).status, 400);
});

test('preuve signée : claims comparés au challenge, preuve opaque refusée en mode jwt', async (t) => {
  const oidc = await startFakeOidc(t);
  const backend = await startBackendMock(t);
  const { url } = await startToolingApp(t, { ...oidc.env, BACKEND_URL: backend });
  const control = await oidc.sign({ azp: 'backend-mandates', scope: 'mandates:grant' });
  const grant = async (overrides: Record<string, unknown> = {}, claimOverrides: Record<string, unknown> = {}) => {
    const value = challenge(overrides);
    value.proofToken = await oidc.signProof(value, claimOverrides);
    return postInternal(url, '/internal/v1/mandates', { challenge: value, acceptedAt: new Date().toISOString(), evidenceRef: 'proof_test' }, { token: control });
  };
  assert.equal((await grant()).status, 201);
  assert.equal((await grant({}, { scopes: ['requests:write'] })).status, 403);
  assert.equal((await grant({}, { conversationId: fakeId('cnv') })).status, 403);
  assert.equal((await grant({}, { procedureId: 'other' })).status, 403);
  const opaque = await postInternal(url, '/internal/v1/mandates', { challenge: challenge(), acceptedAt: new Date().toISOString(), evidenceRef: 'proof_test' }, { token: control });
  assert.equal(opaque.status, 403);
});

test('idempotence concurrente : une seule demande créée pour la même clé', async (t) => {
  const { url, db } = await setup(t);
  const { body } = await grantMandate(url);
  const key = randomUUID();
  const results = await Promise.all(Array.from({ length: 5 }, () => act(url, 'request.create', { procedureId: 'demo-procedure' }, { mandateId: body.id as string, key })));
  const ids = new Set(results.map((result) => result.structuredContent?.id));
  assert.equal(ids.size, 1);
  const rows = await db.transaction('system', (tx) => tx.query('select count(*)::int as n from requests'));
  assert.equal(rows[0].n, 1);
});

test('sécurité au niveau des lignes : une transaction ne voit que les données de son usager', async (t) => {
  const { url, db } = await setup(t);
  const { body } = await grantMandate(url);
  await act(url, 'request.create', { procedureId: 'demo-procedure' }, { mandateId: body.id as string });
  const own = await db.transaction({ userRef: USER_REF }, (tx) => tx.query('select id from requests'));
  const other = await db.transaction({ userRef: OTHER_USER }, (tx) => tx.query('select id from requests union all select id from mandates'));
  assert.equal(own.length, 1);
  assert.equal(other.length, 0);
  assert.equal((await db.transaction({ userRef: USER_REF }, (tx) => tx.query('select id from audit_log'))).length, 0);
  await assert.rejects(db.transaction({ userRef: USER_REF }, (tx) => tx.query('delete from requests')), /permission denied/);
  await assert.rejects(
    db.transaction({ userRef: OTHER_USER }, (tx) => tx.query("insert into requests (id, conversation_id, user_ref, procedure_id, status) values ('req_x', $1, $2, 'p', 'draft')", [CONVERSATION_ID, USER_REF])),
    /row-level security/,
  );
});

test('journal en ajout seul et événements C4 conformes écrits avec chaque effet', async (t) => {
  const { url, db } = await setup(t);
  const { body } = await grantMandate(url);
  const created = await act(url, 'request.create', { procedureId: 'demo-procedure' }, { mandateId: body.id as string });
  await act(url, 'request.update', { requestId: created.structuredContent!.id, fields: { npi: '123' } }, { mandateId: body.id as string });

  const audit = await db.transaction('system', (tx) => tx.query<Record<string, unknown>>('select actor, action, outcome, code, request_id from audit_log order by id'));
  assert.deepEqual(
    audit.map((row) => [row.actor, row.action, row.outcome, row.code]),
    [
      ['backend-mandates', 'mandate.grant', 'success', 'OK'],
      ['backend-agent', 'request.create', 'success', 'OK'],
      ['backend-agent', 'request.update', 'error', 'INVALID_REQUEST'],
    ],
  );
  assert.equal(audit[1].request_id, created.structuredContent!.id);
  assert.ok(!JSON.stringify(audit).includes('123'), 'aucune valeur de champ dans le journal');
  await assert.rejects(db.ownerTransaction((tx) => tx.query('update audit_log set code = $1', ['X'])), /ajout seul/);
  await assert.rejects(db.ownerTransaction((tx) => tx.query('delete from audit_log')), /ajout seul/);

  const events = await db.transaction('system', (tx) => tx.query<{ event: { type: string; data: { outcome?: string } } }>('select event from outbox order by seq'));
  events.forEach(({ event }) => assertSchema('Event', event));
  assert.deepEqual(
    events.map(({ event }) => event.type),
    ['bj.techma.request.created.v1', 'bj.techma.tool.called.v1', 'bj.techma.tool.called.v1'],
  );
  assert.equal(events[2].event.data.outcome, 'error');
});
