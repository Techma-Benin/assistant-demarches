import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';
import { processSnapshot, probeService, startRuntimeDiagnostics } from './runtime-diagnostics.mjs';
import { createDiagnostics } from './diagnostics.mjs';

const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
const close = (server) => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); });

test('process snapshots contain counters, not credential-bearing command lines', async (t) => {
  const processes = await processSnapshot();
  if (!Array.isArray(processes)) return t.skip('/proc unavailable on this host');
  assert.ok(processes.some((row) => row.pid === process.pid));
  assert.ok(processes.every((row) => !('args' in row) && !('command' in row) && Number.isFinite(row.rssMb)));
});

test('service probes record status and timing without URLs or response content', async (t) => {
  const events = [];
  const server = createServer((_req, res) => { res.writeHead(503); res.end('PRIVATE_RESPONSE'); });
  const port = await listen(server);
  t.after(() => close(server));
  const result = await probeService({ name: 'backend', url: `http://127.0.0.1:${port}/?token=PRIVATE_QUERY` },
    (event, fields, level) => events.push({ event, ...fields, level }));
  assert.equal(result.status, 503);
  assert.equal(events[0].level, 'warning');
  assert.ok(!JSON.stringify(events).includes('PRIVATE'));
});

test('hung service probes time out instead of blocking future heartbeat work', async (t) => {
  const server = createServer(() => {});
  const port = await listen(server);
  t.after(() => close(server));
  const result = await probeService({ name: 'interface', url: `http://127.0.0.1:${port}/` }, () => {}, 20);
  assert.equal(result.error.name, 'TimeoutError');
  assert.equal(result.status, undefined);
});

test('heartbeat and probes emit independently and stop with the runtime', async (t) => {
  const events = [];
  const server = createServer((_req, res) => res.end('ok'));
  const port = await listen(server);
  t.after(() => close(server));
  const diagnostics = createDiagnostics({ write: (line) => { events.push(JSON.parse(line)); return true; } });
  const stop = startRuntimeDiagnostics({
    diagnostics, gateway: { diagnosticsSnapshot: () => ({ activeHttp: 0 }) },
    state: () => ({ stage: 'ready', ready: true }),
    services: [{ name: 'interface', url: `http://127.0.0.1:${port}/` }], intervalMs: 15, probeIntervalMs: 15,
  });
  t.after(stop);
  for (let n = 0; n < 100 && !(events.some((event) => event.event === 'runtime.heartbeat')
    && events.some((event) => event.event === 'service.probe')); n++) await sleep(10);
  stop();
  assert.ok(events.some((event) => event.event === 'runtime.heartbeat' && event.requests.activeHttp === 0));
  assert.ok(events.some((event) => event.event === 'service.probe' && event.status === 200));
  assert.ok(events.every((event) => event.bootId === diagnostics.bootId));
  await sleep(30);
  const count = events.length;
  await sleep(50);
  assert.equal(events.length, count);
});
