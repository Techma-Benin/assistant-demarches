import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Housekeeping } from '../src/events/events.module.js';
import { Outbox } from '../src/events/outbox.js';
import { OutboxPublisher } from '../src/events/outbox-publisher.js';
import { act, CONVERSATION_ID, fakeId, rows, startStack, type Stack } from './helpers.js';

const TRACE = '1'.repeat(32);

async function enqueue(s: Stack, conversationId: string, count: number): Promise<string[]> {
  const outbox = s.app.get(Outbox);
  const ids: string[] = [];
  for (let n = 0; n < count; n += 1) {
    ids.push(await s.db.transaction('system', (tx) => outbox.enqueue(tx, { kind: 'tool.called', toolName: 'procedures.get', conversationId, outcome: 'success', code: 'OK' }, TRACE)));
  }
  return ids;
}

const makeAvailable = (s: Stack) => rows(s, 'update outbox set available_at = now() where published_at is null');

test('publication : événements v2 livrés au Backend dans l’ordre, avec le jeton du client tooling', async (t) => {
  const s = await startStack(t);
  await act(s, 'procedures.get', { procedureId: 'PS00373' });
  const ids = await enqueue(s, CONVERSATION_ID, 2);
  const publisher = s.app.get(OutboxPublisher);
  while ((await publisher.tick()) > 0);
  assert.deepEqual(s.backend.events.slice(-2).map((event) => event.id), ids);
  assert.ok(s.backend.events.every((event) => event.type === `bj.techma.${event.data.kind}.v2`));
  assert.equal(s.backend.events[0].data.kind, 'tool.called');
  assert.equal(s.keycloak.tokenRequests, 1, 'jeton de service obtenu une fois puis réutilisé');
  assert.equal((await rows(s, 'select 1 from outbox where published_at is null')).length, 0);
});

test('reprise : échec temporaire retenté avec délai, ordre conservé par conversation', async (t) => {
  const s = await startStack(t);
  const [first, second] = await enqueue(s, CONVERSATION_ID, 2);
  const other = await enqueue(s, fakeId('cnv'), 1);
  const publisher = s.app.get(OutboxPublisher);
  s.backend.failEvents = 1;
  await publisher.tick();
  const [row] = await rows<{ attempts: number; last_error: string }>(s, 'select attempts, last_error from outbox where id = $1', [first]);
  assert.equal(row.last_error, 'HTTP 503');
  assert.ok(!s.backend.events.some((event) => event.id === second), 'le suivant attend le premier');
  assert.ok(s.backend.events.some((event) => event.id === other[0]), 'une autre conversation n’est pas bloquée');
  await makeAvailable(s);
  while ((await publisher.tick()) > 0) await makeAvailable(s);
  const order = s.backend.events.map((event) => event.id).filter((id) => id === first || id === second);
  assert.deepEqual(order, [first, second]);
});

test('Backend injoignable : la boucle survit et l’événement reste en attente', async (t) => {
  const s = await startStack(t, { BACKEND_URL: 'http://127.0.0.1:9' });
  await enqueue(s, CONVERSATION_ID, 1);
  assert.equal(await s.app.get(OutboxPublisher).tick(), 1);
  const [row] = await rows<{ published_at: unknown; last_error: string }>(s, 'select published_at, last_error from outbox');
  assert.equal(row.published_at, null);
  assert.equal(row.last_error, 'network');
});

test('entretien : clés d’idempotence purgées après 25 h seulement', async (t) => {
  const s = await startStack(t);
  await rows(s, "insert into idempotency_keys (key_hash, request_digest, created_at) values ('old', 'd', now() - interval '26 hours'), ('recent', 'd', now() - interval '23 hours')");
  await s.app.get(Housekeeping).purge();
  assert.deepEqual((await rows<{ key_hash: string }>(s, 'select key_hash from idempotency_keys order by key_hash')).map((row) => row.key_hash), ['recent']);
});
