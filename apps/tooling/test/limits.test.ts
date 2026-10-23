import assert from 'node:assert/strict';
import { test } from 'node:test';
import { act, fakeId, rawInitialize, startBackendMock, startFakeOidc, startToolingApp, CONVERSATION_ID, USER_REF } from './helpers.js';

const agentHeaders = { Authorization: 'Bearer mock-agent', 'X-Conversation-Id': CONVERSATION_ID, 'X-User-Ref': USER_REF };

test('débit par usager : l’agent reçoit RATE_LIMITED, les autres usagers continuent', async (t) => {
  const backend = await startBackendMock(t);
  const { url, db } = await startToolingApp(t, { AUTH_MODE: 'mock-tokens', BACKEND_URL: backend, RATE_LIMIT_USER_PER_MIN: '3' });
  for (let n = 0; n < 3; n += 1) assert.ok(!(await act(url, 'procedures.get', { procedureId: 'demo-procedure' })).isError);
  const limited = JSON.parse((await act(url, 'procedures.get', { procedureId: 'demo-procedure' })).content[0].text);
  assert.equal(limited.code, 'RATE_LIMITED');
  assert.ok(limited.retryAfter >= 1 && limited.retryAfter <= 60);
  assert.ok(!(await act(url, 'procedures.get', { procedureId: 'demo-procedure' }, { userRef: `usr_${'0'.repeat(25)}2` })).isError);

  // Refus journalisé, mais pas relayé au Backend ; compteurs sans identifiant en clair.
  const audit = await db.transaction('system', (tx) => tx.query<{ code: string }>("select code from audit_log where code = 'RATE_LIMITED'"));
  assert.equal(audit.length, 1);
  const relayed = await db.transaction('system', (tx) => tx.query("select 1 from outbox where event->'data'->>'code' = 'RATE_LIMITED'"));
  assert.equal(relayed.length, 0);
  const buckets = await db.transaction('system', (tx) => tx.query<{ bucket: string }>('select bucket from rate_limits'));
  assert.ok(buckets.every(({ bucket }) => /^[a-f0-9]{64}$/.test(bucket) && !bucket.includes(USER_REF)));
});

test('débit par client de service : 429 problem+json avec Retry-After', async (t) => {
  const { url } = await startToolingApp(t, { AUTH_MODE: 'mock-tokens', RATE_LIMIT_CLIENT_PER_MIN: '2' });
  assert.equal((await rawInitialize(url, agentHeaders)).status, 200);
  assert.equal((await rawInitialize(url, agentHeaders)).status, 200);
  const res = await rawInitialize(url, agentHeaders);
  assert.equal(res.status, 429);
  assert.equal(((await res.json()) as { code: string }).code, 'RATE_LIMITED');
  assert.match(res.headers.get('retry-after') ?? '', /^\d+$/);
});

test('échecs d’authentification répétés : l’adresse est bloquée, même avec un jeton valide', async (t) => {
  const { url } = await startToolingApp(t, { AUTH_MODE: 'mock-tokens', RATE_LIMIT_AUTH_FAILURES_PER_MIN: '3' });
  for (let n = 0; n < 3; n += 1) assert.equal((await rawInitialize(url, { ...agentHeaders, Authorization: `Bearer guess-${n}` })).status, 401);
  const blocked = await rawInitialize(url, agentHeaders);
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get('retry-after')) >= 1);
  // Le contrôle des mandats partage la même protection.
  const control = await fetch(`${url}/internal/v1/mandates/${fakeId('mdt')}/revoke`, {
    method: 'POST',
    headers: { Authorization: 'Bearer mock-backend-control', traceparent: `00-${'1'.repeat(32)}-${'2'.repeat(16)}-01`, 'Idempotency-Key': 'key-12345678' },
  });
  assert.equal(control.status, 429);
});

test('503 : Retry-After présent, comme l’exige le contrat', async (t) => {
  const oidc = await startFakeOidc(t);
  const { url } = await startToolingApp(t, { ...oidc.env, JWKS_URL: 'http://127.0.0.1:9/jwks' });
  const res = await rawInitialize(url, { ...agentHeaders, Authorization: `Bearer ${await oidc.sign()}` });
  assert.equal(res.status, 503);
  assert.equal(res.headers.get('retry-after'), '5');
});

test('derrière le proxy : X-Forwarded-For pris en compte seulement si TRUST_PROXY l’autorise', async (t) => {
  const trusted = await startToolingApp(t, { AUTH_MODE: 'mock-tokens', RATE_LIMIT_AUTH_FAILURES_PER_MIN: '1', TRUST_PROXY: 'loopback' });
  await rawInitialize(trusted.url, { ...agentHeaders, Authorization: 'Bearer wrong', 'X-Forwarded-For': '10.0.0.1' });
  // Autre client réel derrière le même proxy : pas bloqué par les échecs du premier.
  assert.equal((await rawInitialize(trusted.url, { ...agentHeaders, 'X-Forwarded-For': '10.0.0.2' })).status, 200);
  assert.equal((await rawInitialize(trusted.url, { ...agentHeaders, 'X-Forwarded-For': '10.0.0.1' })).status, 429);

  const direct = await startToolingApp(t, { AUTH_MODE: 'mock-tokens', RATE_LIMIT_AUTH_FAILURES_PER_MIN: '1' });
  await rawInitialize(direct.url, { ...agentHeaders, Authorization: 'Bearer wrong', 'X-Forwarded-For': '10.0.0.1' });
  // Sans proxy de confiance, l'en-tête est ignoré : un attaquant ne peut pas changer d'adresse.
  assert.equal((await rawInitialize(direct.url, { ...agentHeaders, 'X-Forwarded-For': '10.0.0.9' })).status, 429);
});
