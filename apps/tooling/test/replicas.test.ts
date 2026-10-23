import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import pg from 'pg';
import { Outbox } from '../src/events/outbox.js';
import { OutboxPublisher } from '../src/events/outbox-publisher.js';
import { act, fakeId, grantMandate, startBackendMock, startToolingApp } from './helpers.js';

const admin = process.env.TEST_DATABASE_URL;

/** Deux répliques sur une même base PostgreSQL réelle, comme en déploiement. */
async function twoReplicas(t: Parameters<typeof startToolingApp>[0], backendUrl: string) {
  const name = `tooling_replicas_${randomBytes(6).toString('hex')}`;
  const run = async (sql: string) => {
    const client = new pg.Client(admin);
    await client.connect();
    try {
      await client.query(sql);
    } finally {
      await client.end();
    }
  };
  await run(`create database ${name}`);
  t.after(() => run(`drop database if exists ${name} with (force)`));
  const url = new URL(admin!);
  url.pathname = `/${name}`;
  const env = { AUTH_MODE: 'mock-tokens', BACKEND_URL: backendUrl, DATABASE_URL: url.href };
  // Démarrage simultané : les migrations se sérialisent sous le verrou consultatif.
  return Promise.all([startToolingApp(t, env), startToolingApp(t, env)]);
}

test('répliques : même clé d’idempotence envoyée aux deux, une seule demande', { skip: !admin && 'TEST_DATABASE_URL absent' }, async (t) => {
  const backend = await startBackendMock(t);
  const [a, b] = await twoReplicas(t, backend);
  const { body } = await grantMandate(a.url);
  const key = randomUUID();
  const results = await Promise.all(
    Array.from({ length: 6 }, (_, n) => act(n % 2 ? a.url : b.url, 'request.create', { procedureId: 'demo-procedure' }, { mandateId: body.id as string, key })),
  );
  assert.equal(new Set(results.map((result) => result.structuredContent?.id)).size, 1);
  const [{ n }] = await a.db.transaction('system', (tx) => tx.query<{ n: number }>('select count(*)::int as n from requests'));
  assert.equal(n, 1);

  // Révocation reçue par une réplique : effet immédiat sur l'autre.
  await fetch(`${b.url}/internal/v1/mandates/${body.id}/revoke`, {
    method: 'POST',
    headers: { Authorization: 'Bearer mock-backend-control', traceparent: `00-${'1'.repeat(32)}-${'2'.repeat(16)}-01`, 'Idempotency-Key': randomUUID() },
  });
  const after = await act(a.url, 'request.create', { procedureId: 'demo-procedure' }, { mandateId: body.id as string });
  assert.equal(JSON.parse(after.content[0].text).code, 'MANDATE_REVOKED');
});

test('répliques : publieurs concurrents, chaque événement livré une seule fois', { skip: !admin && 'TEST_DATABASE_URL absent' }, async (t) => {
  const received: string[] = [];
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    received.push((JSON.parse(body) as { id: string }).id);
    await new Promise((resolve) => setTimeout(resolve, 20));
    res.writeHead(202).end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const [a, b] = await twoReplicas(t, `http://127.0.0.1:${(server.address() as AddressInfo).port}`);

  const outbox = a.app.get(Outbox);
  for (let c = 0; c < 10; c += 1) {
    const conversation = fakeId('cnv');
    for (let n = 0; n < 3; n += 1) {
      await a.db.transaction('system', (tx) => outbox.enqueue(tx, { kind: 'tool.called', toolName: 'procedures.get', conversationId: conversation, outcome: 'success', code: 'OK' }, '1'.repeat(32)));
    }
  }
  const publishers = [a.app.get(OutboxPublisher), b.app.get(OutboxPublisher)];
  for (let round = 0; round < 10; round += 1) await Promise.all(publishers.map((publisher) => publisher.tick()));

  assert.equal(received.length, 30);
  assert.equal(new Set(received).size, 30);
  const [{ pending }] = await a.db.transaction('system', (tx) => tx.query<{ pending: number }>('select count(*)::int as pending from outbox where published_at is null'));
  assert.equal(pending, 0);
});
