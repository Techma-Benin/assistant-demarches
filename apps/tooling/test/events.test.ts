import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { test, type TestContext } from 'node:test';
import { Housekeeping } from '../src/events/events.module.js';
import { Outbox } from '../src/events/outbox.js';
import { OutboxPublisher } from '../src/events/outbox-publisher.js';
import { act, fakeId, grantMandate, startBackendMock, startToolingApp, TRACEPARENT } from './helpers.js';

const TRACE = '1'.repeat(32);

async function scriptedBackend(t: TestContext, script: (eventId: string, attempt: number) => number | Promise<number>) {
  const received: string[] = [];
  const attempts = new Map<string, number>();
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const event = JSON.parse(body) as { id: string };
    const attempt = (attempts.get(event.id) ?? 0) + 1;
    attempts.set(event.id, attempt);
    received.push(event.id);
    assert.equal(req.headers['idempotency-key'], event.id);
    assert.equal(req.headers.authorization, 'Bearer mock-tooling-events');
    res.writeHead(await script(event.id, attempt), { 'content-type': 'application/json' }).end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, received };
}

async function enqueue(app: Awaited<ReturnType<typeof startToolingApp>>, conversationId: string, count: number): Promise<string[]> {
  const outbox = app.app.get(Outbox);
  const ids: string[] = [];
  for (let n = 0; n < count; n += 1) {
    ids.push(await app.db.transaction('system', (tx) => outbox.enqueue(tx, { kind: 'tool.called', toolName: 'procedures.get', conversationId, outcome: 'success', code: 'OK' }, TRACE)));
  }
  return ids;
}

const makeAvailable = (app: Awaited<ReturnType<typeof startToolingApp>>) => app.db.transaction('system', (tx) => tx.query('update outbox set available_at = now() where published_at is null'));

test('publication vers le Backend simulé : événements reçus dans l’ordre et dédupliqués', async (t) => {
  const backend = await startBackendMock(t);
  const tooling = await startToolingApp(t, { AUTH_MODE: 'mock-tokens', BACKEND_URL: backend });
  const res = await fetch(`${backend}/v1/conversations`, {
    method: 'POST',
    headers: { Authorization: 'Bearer mock-user', traceparent: TRACEPARENT, 'Idempotency-Key': 'conversation-events-1', 'Content-Type': 'application/json' },
    body: JSON.stringify({ locale: 'fr' }),
  });
  const conversationId = ((await res.json()) as { id: string }).id;
  const { body } = await grantMandate(tooling.url, { conversationId });
  await act(tooling.url, 'request.create', { procedureId: 'PS00373' }, { mandateId: body.id as string, conversationId });

  const publisher = tooling.app.get(OutboxPublisher);
  assert.equal(await publisher.tick(), 1);
  assert.equal(await publisher.tick(), 0);

  const page = await fetch(`${backend}/v1/conversations/${conversationId}/events`, { headers: { Authorization: 'Bearer mock-user', traceparent: TRACEPARENT } });
  const items = ((await page.json()) as { items: { type: string; source: string }[] }).items;
  assert.deepEqual(
    items.map((event) => event.type),
    ['bj.techma.tool.called.v2'],
  );
  assert.ok(items.every((event) => event.source === 'urn:techma:tooling'));
});

test('reprise : échec temporaire retenté avec délai, ordre conservé, refus définitif mis de côté', async (t) => {
  const failing = new Set<string>();
  const rejected = new Set<string>();
  const backend = await scriptedBackend(t, (id, attempt) => (rejected.has(id) ? 400 : failing.has(id) && attempt <= 2 ? 503 : 202));
  const tooling = await startToolingApp(t, { AUTH_MODE: 'mock-tokens', BACKEND_URL: backend.url });
  const publisher = tooling.app.get(OutboxPublisher);
  const conversation = fakeId('cnv');
  const [first, second] = await enqueue(tooling, conversation, 2);
  failing.add(first);

  await publisher.tick();
  const [row] = await tooling.db.transaction('system', (tx) => tx.query<{ attempts: number; last_error: string; wait: number }>('select attempts, last_error, extract(epoch from available_at - now())::float as wait from outbox where id = $1', [first]));
  assert.equal(row.attempts, 1);
  assert.equal(row.last_error, 'HTTP 503');
  assert.ok(row.wait > 0 && row.wait <= 1.5, `délai ${row.wait}`);
  assert.equal(await publisher.tick(), 0);
  await makeAvailable(tooling);
  await publisher.tick();
  await makeAvailable(tooling);
  await publisher.tick();
  await publisher.tick();
  assert.deepEqual(backend.received, [first, first, first, second]);

  const [poison, next] = await enqueue(tooling, conversation, 2);
  rejected.add(poison);
  await publisher.tick();
  await publisher.tick();
  const states = await tooling.db.transaction('system', (tx) => tx.query<{ id: string; dead: boolean; published: boolean }>('select id, dead_at is not null as dead, published_at is not null as published from outbox where id = any($1)', [[poison, next]]));
  assert.deepEqual(Object.fromEntries(states.map((state) => [state.id, [state.dead, state.published]])), { [poison]: [true, false], [next]: [false, true] });
});

test('bail : un lot en cours de livraison n’est pas repris par un second publieur', async (t) => {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const backend = await scriptedBackend(t, async () => {
    await gate;
    return 202;
  });
  const tooling = await startToolingApp(t, { AUTH_MODE: 'mock-tokens', BACKEND_URL: backend.url });
  const publisher = tooling.app.get(OutboxPublisher);
  await enqueue(tooling, fakeId('cnv'), 1);
  const inFlight = publisher.tick();
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(await publisher.tick(), 0);
  release();
  assert.equal(await inFlight, 1);
  assert.equal(backend.received.length, 1);
});

test('Backend injoignable : la boucle survit et l’événement reste en attente', async (t) => {
  const tooling = await startToolingApp(t, { AUTH_MODE: 'mock-tokens', BACKEND_URL: 'http://127.0.0.1:9' });
  const [id] = await enqueue(tooling, fakeId('cnv'), 1);
  await tooling.app.get(OutboxPublisher).tick();
  const [row] = await tooling.db.transaction('system', (tx) => tx.query<{ last_error: string; published_at: unknown }>('select last_error, published_at from outbox where id = $1', [id]));
  assert.deepEqual(row, { last_error: 'network', published_at: null });
});

test('entretien : clés d’idempotence purgées après 25 h seulement', async (t) => {
  const tooling = await startToolingApp(t, { AUTH_MODE: 'mock-tokens' });
  await tooling.db.transaction('system', (tx) =>
    tx.query("insert into idempotency_keys (key_hash, request_digest, created_at) values ('old', 'd', now() - interval '26 hours'), ('recent', 'd', now() - interval '23 hours')"),
  );
  assert.equal(await tooling.app.get(Housekeeping).purge(), 1);
});
