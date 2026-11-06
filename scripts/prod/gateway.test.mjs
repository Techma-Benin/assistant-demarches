import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer, request } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { createGateway } from './gateway.mjs';

const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
const close = (server) => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); });
const rawGet = (port, path) => new Promise((resolve, reject) => {
  const req = request({ hostname: '127.0.0.1', port, path }, (res) => { res.resume(); resolve(res.statusCode); });
  req.on('error', reject); req.end();
});

test('HTTP proxy preserves bodies/cookies and sets canonical forwarded headers', async (t) => {
  const app = createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      res.setHeader('set-cookie', 'demo=value; HttpOnly; Path=/');
      res.end(JSON.stringify({ path: req.url, body: Buffer.concat(chunks).toString(), headers: req.headers }));
    });
  });
  const appPort = await listen(app);
  const gateway = createGateway({ origin: 'https://showcase.example', ports: { interface: appPort } });
  const port = await listen(gateway);
  t.after(async () => { await close(gateway); await close(app); });
  const res = await fetch(`http://127.0.0.1:${port}/api/session?q=1`, {
    method: 'POST', headers: { cookie: 'session=abc', 'x-forwarded-host': 'attacker.example' }, body: 'hello',
  });
  const result = await res.json();
  assert.equal(result.path, '/api/session?q=1');
  assert.equal(result.body, 'hello');
  assert.equal(result.headers.cookie, 'session=abc');
  assert.equal(result.headers['x-forwarded-host'], 'showcase.example');
  assert.equal(result.headers['x-forwarded-proto'], 'https');
  assert.match(res.headers.get('set-cookie'), /HttpOnly/);
});

test('only Techma identity routes are public, including during startup', async (t) => {
  const identity = createServer((req, res) => res.end(req.url));
  const identityPort = await listen(identity);
  const gateway = createGateway({
    origin: 'https://showcase.example', ports: { keycloak: identityPort }, ready: () => false,
  });
  const port = await listen(gateway);
  t.after(async () => { await close(gateway); await close(identity); });
  const starting = await fetch(`http://127.0.0.1:${port}/`);
  assert.equal(starting.status, 200);
  assert.equal(starting.headers.get('cache-control'), 'no-store');
  assert.match(await starting.text(), /Starting the simulation/);
  assert.equal((await fetch(`http://127.0.0.1:${port}/`, { method: 'HEAD' })).status, 200);
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/session`)).status, 503);
  assert.equal((await fetch(`http://127.0.0.1:${port}/auth/logout`, { method: 'POST' })).status, 503);
  assert.equal((await fetch(`http://127.0.0.1:${port}/health/ready`)).status, 503);
  assert.equal(await (await fetch(`http://127.0.0.1:${port}/keycloak/realms/techma/.well-known/openid-configuration`)).text(),
    '/realms/techma/.well-known/openid-configuration');
  for (const path of ['/keycloak/admin', '/keycloak/realms/master', '/keycloak/realms/techma/../../admin',
    '/keycloak/realms/techma/%2e%2e/admin', '/keycloak/resources/../admin']) {
    assert.equal(await rawGet(port, path), 404, path);
  }
});

test('WebSocket upgrades preserve Origin, ticket and cursor on the same public port', async (t) => {
  let observed;
  const events = [];
  const backend = createServer();
  const wss = new WebSocketServer({ noServer: true });
  backend.on('upgrade', (req, socket, head) => {
    observed = req;
    if (!req.url.includes('ticket=valid')) return socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
    wss.handleUpgrade(req, socket, head, (ws) => ws.on('message', (message) => ws.send(message)));
  });
  const backendPort = await listen(backend);
  const gateway = createGateway({
    origin: 'https://showcase.example', ports: { backend: backendPort },
    diagnostics: (event, fields) => events.push({ event, ...fields }),
  });
  const port = await listen(gateway);
  t.after(async () => {
    for (const client of wss.clients) client.terminate();
    wss.close();
    await close(gateway); await close(backend);
  });
  const ws = new WebSocket(`ws://127.0.0.1:${port}/v1/stream?ticket=valid&cursor=replay`, { origin: 'https://showcase.example' });
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  const echo = new Promise((resolve) => ws.once('message', (message) => resolve(message.toString())));
  ws.send('event');
  assert.equal(await echo, 'event');
  assert.equal(gateway.diagnosticsSnapshot().openWebSockets, 1);
  assert.equal(observed.url, '/v1/stream?ticket=valid&cursor=replay');
  assert.equal(observed.headers.origin, 'https://showcase.example');
  await new Promise((resolve) => { ws.once('close', resolve); ws.close(); });
  const rejected = new WebSocket(`ws://127.0.0.1:${port}/v1/stream?ticket=invalid`);
  rejected.on('error', () => {});
  assert.equal(await new Promise((resolve) => rejected.once('unexpected-response', (_req, res) => {
    res.resume(); rejected.terminate(); resolve(res.statusCode);
  })), 401);
  assert.ok(events.some((event) => event.event === 'websocket.open'));
  assert.ok(events.some((event) => event.outcome === 'rejected' && event.status === 401));
  assert.ok(!JSON.stringify(events).includes('ticket='));
  assert.ok(!JSON.stringify(events).includes('cursor='));
});
