import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer, request } from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';
import { createDiagnostics, safeError, safePath } from './diagnostics.mjs';
import { createGateway } from './gateway.mjs';

const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
const close = (server) => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); });

test('route labels exclude queries, arbitrary filenames, account IDs and encoded input', () => {
  assert.equal(safePath('/auth/logout?code=PRIVATE'), '/auth/logout');
  assert.equal(safePath('/api/conversations/person-123/messages?ticket=PRIVATE'), '/api/conversations/:value/messages');
  assert.equal(safePath('/photos/private-person.jpg'), '/photos/:value');
  assert.equal(safePath('/%74oken/PRIVATE#PRIVATE'), '/:value/:value');
  assert.ok(!safePath('/' + 'private/'.repeat(100)).includes('private'));
});

test('error summaries exclude messages, stacks and arbitrary error codes', () => {
  const error = Object.assign(new Error('PRIVATE_TOKEN'), { code: 'ECONNREFUSED' });
  assert.deepEqual(safeError(error), { name: 'Error', code: 'ECONNREFUSED' });
  assert.ok(!JSON.stringify(safeError(error)).includes('PRIVATE_TOKEN'));
  assert.equal(safeError({ code: 'https://private.example?token=PRIVATE_TOKEN' }).code, undefined);
});

test('structured logs share a boot ID and have a bounded backpressure queue', () => {
  const lines = [];
  let drain;
  const diagnostics = createDiagnostics({
    write: (line) => { lines.push(JSON.parse(line)); return lines.length !== 1; },
    onDrain: (callback) => { drain = callback; }, maxQueued: 2,
  });
  for (let n = 0; n < 4; n++) diagnostics.emit('test.event', { n });
  assert.deepEqual(diagnostics.stats(), { queuedLogLines: 2, droppedLogLines: 1 });
  drain();
  assert.equal(lines.length, 3);
  assert.ok(lines.every((line) => line.bootId === diagnostics.bootId && line.timestamp && line.pid));
  assert.equal(diagnostics.stats().queuedLogLines, 0);
});

test('HTTP requests are correlated through start, upstream, headers and completion without secrets', async (t) => {
  const events = [];
  let upstreamId;
  const app = createServer((req, res) => {
    upstreamId = req.headers['x-request-id'];
    res.writeHead(201, { 'set-cookie': 'private=COOKIE_CANARY', location: '/?token=LOCATION_CANARY' });
    res.end('BODY_CANARY');
  });
  const appPort = await listen(app);
  const gateway = createGateway({
    origin: 'https://showcase.example', ports: { interface: appPort },
    diagnostics: (event, fields) => events.push({ event, ...fields }),
  });
  const port = await listen(gateway);
  t.after(async () => { await close(gateway); await close(app); });
  const response = await fetch(`http://127.0.0.1:${port}/auth/logout?code=QUERY_CANARY`, {
    method: 'POST', headers: { authorization: 'Bearer AUTH_CANARY', cookie: 'value=COOKIE_CANARY', 'x-request-id': 'UNTRUSTED_CANARY' },
    body: 'BODY_CANARY', redirect: 'manual',
  });
  await response.text();
  assert.equal(response.status, 201);
  assert.equal(response.headers.get('x-request-id'), upstreamId);
  assert.notEqual(upstreamId, 'UNTRUSTED_CANARY');
  assert.ok(events.some((event) => event.event === 'request.start'));
  assert.ok(events.some((event) => event.phase === 'upstream_headers' && event.status === 201));
  assert.ok(events.some((event) => event.event === 'request.end' && event.status === 201));
  assert.ok(events.every((event) => event.requestId === upstreamId));
  assert.ok(!JSON.stringify(events).includes('CANARY'));
  assert.equal(gateway.diagnosticsSnapshot().activeHttp, 0);
});

test('stalled upstreams and client cancellation leave evidence and release active tracking', async (t) => {
  const events = [];
  const app = createServer(() => {});
  const appPort = await listen(app);
  const gateway = createGateway({
    origin: 'https://showcase.example', ports: { interface: appPort },
    diagnostics: (event, fields) => events.push({ event, ...fields }), traceOptions: { stalledMs: 10 },
  });
  const port = await listen(gateway);
  t.after(async () => { await close(gateway); await close(app); });
  const req = request({ hostname: '127.0.0.1', port, path: '/conversation?ticket=PRIVATE' });
  req.on('error', () => {}); req.end();
  for (let n = 0; n < 100 && !events.some((event) => event.event === 'request.pending'); n++) await sleep(5);
  assert.ok(events.some((event) => event.event === 'request.pending' && event.upstream === 'interface'));
  assert.equal(gateway.diagnosticsSnapshot().pending[0].path, '/conversation');
  req.destroy();
  for (let n = 0; n < 100 && gateway.diagnosticsSnapshot().activeHttp; n++) await sleep(5);
  assert.equal(gateway.diagnosticsSnapshot().activeHttp, 0);
  assert.ok(events.some((event) => event.outcome === 'client_aborted'));
  assert.ok(!JSON.stringify(events).includes('PRIVATE'));
});

test('liveness responds independently of application readiness and includes a request ID', async (t) => {
  const gateway = createGateway({ origin: 'https://showcase.example', ports: {}, ready: () => false });
  const port = await listen(gateway);
  t.after(() => close(gateway));
  const response = await fetch(`http://127.0.0.1:${port}/health/live`);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.ready, false);
  assert.equal(body.requestId, response.headers.get('x-request-id'));
  assert.equal((await fetch(`http://127.0.0.1:${port}/health/ready`)).status, 503);
});
