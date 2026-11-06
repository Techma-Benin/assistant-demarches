import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer, get } from 'node:http';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { createDiagnostics } from './diagnostics.mjs';
import { installServiceDiagnostics } from './service-diagnostics.mjs';

const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
const close = (server) => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); });

test('service observers trace incoming requests, native fetch and HTTP calls without sensitive values', async (t) => {
  const events = [];
  const diagnostics = createDiagnostics({
    source: 'interface', write: (line) => { events.push(JSON.parse(line)); return true; },
  });
  const server = createServer((_req, res) => res.end('PRIVATE_BODY'));
  const port = await listen(server);
  const stop = installServiceDiagnostics({ diagnostics, publicOrigin: `http://127.0.0.1:${port}`, intervalMs: 10 });
  t.after(async () => { stop(); await close(server); });
  const requestId = randomUUID();
  const response = await fetch(`http://127.0.0.1:${port}/auth/logout?code=PRIVATE_QUERY`, {
    headers: { 'x-request-id': requestId, cookie: 'SECRET_COOKIE', authorization: 'Bearer SECRET_TOKEN' },
  });
  await response.text();
  await new Promise((resolve, reject) => {
    get(`http://127.0.0.1:${port}/photos/PRIVATE_FILE`, (res) => {
      res.resume(); res.once('end', resolve);
    }).once('error', reject);
  });
  await sleep(25);
  assert.ok(events.some((event) => event.event === 'request.start' && event.transport === 'http' && event.requestId === requestId));
  assert.ok(events.some((event) => event.transport === 'outbound' && event.phase === 'outbound_start'));
  assert.ok(events.some((event) => event.upstream === 'public_origin'));
  assert.ok(events.some((event) => event.event === 'request.end' && event.status === 200));
  assert.ok(events.some((event) => event.event === 'service.heartbeat'));
  assert.ok(events.every((event) => event.source === 'interface'));
  assert.ok(!JSON.stringify(events).includes('PRIVATE'));
  assert.ok(!JSON.stringify(events).includes('SECRET'));
});
