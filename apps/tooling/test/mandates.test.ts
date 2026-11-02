import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { act, assertSchema, challenge, grantMandate, OTHER_USER, postInternal, rows, startStack, toolError, USER_REF } from './helpers.js';

const grantBody = async (s: Awaited<ReturnType<typeof startStack>>, base: ReturnType<typeof challenge>, overrides = {}) => ({
  challenge: { ...base, proofToken: await s.backend.signProof(base, overrides) },
  acceptedAt: new Date().toISOString(),
  evidenceRef: 'consent_test',
});

test('mandat : preuve signée par le Backend, une seule fois, événement mandate.granted', async (t) => {
  const s = await startStack(t);
  const base = challenge('PS00373');
  const body = await grantBody(s, base);
  const key = randomUUID();
  const granted = await postInternal(s, '/internal/v1/mandates', body, { key });
  assert.equal(granted.status, 201, JSON.stringify(granted.body));
  assertSchema('Mandate', granted.body);
  assert.equal(granted.body.status, 'active');
  assert.deepEqual((await postInternal(s, '/internal/v1/mandates', body, { key })).body, granted.body, 'rejeu idempotent');
  assert.equal((await postInternal(s, '/internal/v1/mandates', body)).status, 403, 'preuve déjà consommée');

  const events = await rows<{ event: any }>(s, "select event from outbox where event->>'type' = 'bj.techma.mandate.granted.v2'");
  assert.equal(events.length, 1);
  assertSchema('Event', events[0].event);
  assert.equal(events[0].event.data.mandate.id, granted.body.id);
});

test('mandat : preuve falsifiée, pour un autre usager ou d’autres scopes refusée', async (t) => {
  const s = await startStack(t);
  const base = challenge('PS00373');
  for (const overrides of [{ procedureId: 'PS00393' }, { conversationId: `cnv_${'0'.repeat(25)}9` }, { scopes: ['requests:write'] }]) {
    const res = await postInternal(s, '/internal/v1/mandates', await grantBody(s, base, overrides));
    assert.equal(res.status, 403, JSON.stringify(overrides));
  }
  const forged = { challenge: { ...base, proofToken: 'mock-proof' }, acceptedAt: new Date().toISOString(), evidenceRef: 'consent_test' };
  assert.equal((await postInternal(s, '/internal/v1/mandates', forged)).status, 403);
  assert.equal((await postInternal(s, '/internal/v1/mandates', await grantBody(s, base), { token: await s.keycloak.backend('tools:call') })).status, 403, 'scope des outils');
});

test('révocation : réservée au propriétaire (X-User-Ref), événement mandate.revoked, actions bloquées ensuite', async (t) => {
  const s = await startStack(t);
  const mandateId = await grantMandate(s, 'PS00373');
  assert.equal((await postInternal(s, `/internal/v1/mandates/${mandateId}/revoke`, undefined)).status, 400, 'X-User-Ref obligatoire');
  assert.equal((await postInternal(s, `/internal/v1/mandates/${mandateId}/revoke`, undefined, { userRef: OTHER_USER })).status, 404, 'autre usager');
  const revoked = await postInternal(s, `/internal/v1/mandates/${mandateId}/revoke`, undefined, { userRef: USER_REF });
  assert.equal(revoked.status, 200);
  assert.equal(revoked.body.status, 'revoked');
  assert.equal((await rows(s, "select 1 from outbox where event->>'type' = 'bj.techma.mandate.revoked.v2'")).length, 1);
  assert.equal(toolError(await act(s, 'request.create', { procedureId: 'PS00373' }, { mandateId })).code, 'MANDATE_REVOKED');
});

test('mandat : portée vérifiée à chaque action (démarche, usager, conversation, absence)', async (t) => {
  const s = await startStack(t);
  const mandateId = await grantMandate(s, 'PS00373');
  assert.equal(toolError(await act(s, 'request.create', { procedureId: 'PS00373' })).code, 'MANDATE_MISSING');
  assert.equal(toolError(await act(s, 'request.create', { procedureId: 'PS00393' }, { mandateId })).code, 'MANDATE_SCOPE_DENIED');
  assert.equal(toolError(await act(s, 'request.create', { procedureId: 'PS00373' }, { mandateId, userRef: OTHER_USER })).code, 'MANDATE_MISSING', 'mandat d’un autre usager invisible');
  const narrow = await grantMandate(s, 'PS00393', { scopes: ['requests:write'] });
  const created = await act(s, 'request.create', { procedureId: 'PS00393' }, { mandateId: narrow });
  assert.equal(created.isError, undefined, created.content[0].text);
  assert.equal(
    toolError(await act(s, 'request.submit', { requestId: created.structuredContent!.id }, { mandateId: narrow, channel: 'web' })).code,
    'MANDATE_SCOPE_DENIED',
    'requests:submit absent du mandat',
  );
});
