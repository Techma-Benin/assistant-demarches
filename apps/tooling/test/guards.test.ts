import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { act, grantMandate, ok, OTHER_USER, rows, startStack, toolError, USER_REF } from './helpers.js';

test('débit par usager : RATE_LIMITED pour lui seul, les autres usagers continuent', async (t) => {
  const s = await startStack(t, { RATE_LIMIT_USER_PER_MIN: '2' });
  ok(await act(s, 'procedures.get', { procedureId: 'PS00373' }));
  ok(await act(s, 'procedures.get', { procedureId: 'PS00373' }));
  assert.equal(toolError(await act(s, 'procedures.get', { procedureId: 'PS00373' })).code, 'RATE_LIMITED');
  ok(await act(s, 'procedures.get', { procedureId: 'PS00373' }, { userRef: OTHER_USER }));
});

test('échecs d’authentification répétés : l’adresse est bloquée, même avec un jeton valide', async (t) => {
  const s = await startStack(t, { RATE_LIMIT_AUTH_FAILURES_PER_MIN: '2' });
  for (let n = 0; n < 2; n += 1) {
    assert.equal((await fetch(`${s.url}/mcp`, { method: 'POST', headers: { Authorization: 'Bearer forged' } })).status, 401);
  }
  const res = await fetch(`${s.url}/mcp`, { method: 'POST', headers: { Authorization: `Bearer ${await s.keycloak.backend('tools:call')}` } });
  assert.equal(res.status, 429);
  assert.ok(Number(res.headers.get('retry-after')) > 0);
});

test('idempotence concurrente : une seule demande créée pour la même clé', async (t) => {
  const s = await startStack(t);
  const mandateId = await grantMandate(s, 'PS00373');
  const key = randomUUID();
  const results = await Promise.all([0, 1, 2].map(() => act(s, 'request.create', { procedureId: 'PS00373' }, { mandateId, key })));
  const ids = new Set(results.filter((result) => !result.isError).map((result) => result.structuredContent!.id));
  assert.equal(ids.size, 1);
  assert.equal((await rows(s, 'select id from requests')).length, 1);
  assert.equal(toolError(await act(s, 'request.create', { procedureId: 'PS00393' }, { mandateId, key })).code, 'IDEMPOTENCY_CONFLICT', 'même clé, autre corps');
});

test('sécurité au niveau des lignes : une transaction d’usager ne voit que ses brouillons et mandats', async (t) => {
  const s = await startStack(t);
  const mandateId = await grantMandate(s, 'PS00373');
  ok(await act(s, 'request.create', { procedureId: 'PS00373' }, { mandateId }));
  const seen = (userRef: string) =>
    s.db.transaction({ userRef }, async (tx) => ({
      requests: (await tx.query('select id from requests')).length,
      mandates: (await tx.query('select id from mandates')).length,
    }));
  assert.deepEqual(await seen(USER_REF), { requests: 1, mandates: 1 });
  assert.deepEqual(await seen(OTHER_USER), { requests: 0, mandates: 0 });
});

test('journal : en ajout seul, chaque appel tracé avec son résultat, aucun contenu de pièce', async (t) => {
  const s = await startStack(t);
  const mandateId = await grantMandate(s, 'PS00373');
  ok(await act(s, 'request.create', { procedureId: 'PS00373' }, { mandateId }));
  toolError(await act(s, 'request.create', { procedureId: 'PS00373' }));
  const audit = await rows<{ actor: string; action: string; outcome: string; code: string }>(s, 'select actor, action, outcome, code from audit_log order by id');
  assert.deepEqual(
    audit.map((entry) => `${entry.actor}:${entry.action}:${entry.code}`),
    ['backend:mandate.grant:OK', 'backend:request.create:OK', 'backend:request.create:MANDATE_MISSING'],
  );
  await assert.rejects(rows(s, 'update audit_log set code = $1', ['X']), /ajout seul|permission denied/);
  const called = await rows<{ event: any }>(s, "select event from outbox where event->>'type' = 'bj.techma.tool.called.v2' order by seq");
  assert.deepEqual(called.map(({ event }) => `${event.data.toolName}:${event.data.outcome}:${event.data.code}`), ['request.create:success:OK', 'request.create:error:MANDATE_MISSING']);
});
