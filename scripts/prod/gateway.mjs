import { createServer, request } from 'node:http';
import { createRequestTracker } from './diagnostics.mjs';

/** One public listener; application, identity-provider, and backend ports remain private. */
export function createGateway({ origin, ports, ready = () => true, diagnostics = () => {}, traceOptions = {} }) {
  const publicUrl = new URL(origin);
  const tracker = createRequestTracker({ ...traceOptions, emit: diagnostics, ready });
  const headersFor = (req, requestId) => ({
    ...req.headers,
    host: publicUrl.host,
    'x-forwarded-host': publicUrl.host,
    'x-forwarded-proto': publicUrl.protocol.slice(0, -1),
    'x-forwarded-port': publicUrl.port || (publicUrl.protocol === 'https:' ? '443' : '80'),
    'x-forwarded-for': req.socket.remoteAddress,
    'x-request-id': requestId,
  });
  const server = createServer((req, res) => {
    const trace = tracker.begin(req);
    res.setHeader('x-request-id', trace.id);
    res.once('finish', () => trace.end('complete', { status: res.statusCode }));
    res.once('close', () => {
      if (!res.writableFinished) trace.end('client_aborted', { status: res.headersSent ? res.statusCode : null });
    });
    req.once('aborted', () => trace.end('client_aborted'));
    req.on('error', (error) => trace.error('request.client_error', error));
    // Use the raw path: encoded slashes/dot segments must not bypass the identity route allowlist.
    const path = (req.url || '/').split('?')[0];
    if (path === '/health/live') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      return res.end(JSON.stringify({ status: 'alive', ready: ready(), requestId: trace.id }));
    }
    if (path === '/health/ready') {
      res.writeHead(ready() ? 200 : 503, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      return res.end(JSON.stringify({ status: ready() ? 'ok' : 'starting', simulation: true }));
    }
    let port = ports.interface;
    let target = 'interface';
    let targetPath = req.url;
    if (path.startsWith('/keycloak')) {
      if (!/^\/keycloak\/(?:realms\/techma(?:\/|$)|resources\/)/.test(path)
          || /%|\\|\/\.\.?(?:\/|$)/i.test(path)) {
        res.writeHead(404); return res.end();
      }
      port = ports.keycloak;
      target = 'keycloak';
      targetPath = req.url.slice('/keycloak'.length);
    } else if (!ready() && path === '/' && ['GET', 'HEAD'].includes(req.method)) {
      // The host probes /. A responding gateway is live, but services are not ready yet.
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'retry-after': '3',
      });
      return res.end(req.method === 'HEAD' ? undefined : `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="3"><title>Starting the simulation</title></head>
<body><main><h1>Starting the simulation</h1><p>The demo services are starting. This page refreshes automatically.</p></main></body></html>`);
    } else if (!ready()) {
      res.writeHead(503, { 'retry-after': '3' }); return res.end('Showcase starting');
    }
    trace.phase('upstream_start', target);
    const upstream = request({
      hostname: '127.0.0.1', port, path: targetPath, method: req.method, headers: headersFor(req, trace.id),
    }, (response) => {
      trace.phase('upstream_headers', target, { status: response.statusCode });
      res.writeHead(response.statusCode || 502, { ...response.headers, 'x-request-id': trace.id });
      response.on('error', (error) => { trace.error('request.response_error', error); res.destroy(); });
      response.pipe(res);
    });
    upstream.on('socket', (socket) => {
      if (socket.connecting) socket.once('connect', () => trace.phase('upstream_connected', target));
      else trace.phase('upstream_connected', target);
    });
    upstream.once('finish', () => trace.phase('upstream_request_sent', target));
    upstream.on('error', (error) => {
      trace.error('request.upstream_error', error);
      trace.end('upstream_error', { status: res.headersSent ? res.statusCode : 502 });
      if (!res.headersSent) res.writeHead(502);
      res.end('Upstream unavailable');
    });
    upstream.setTimeout(120_000, () => {
      trace.end('upstream_timeout', { status: res.headersSent ? res.statusCode : 502 });
      upstream.destroy();
    });
    req.on('aborted', () => upstream.destroy());
    res.on('close', () => { if (!res.writableFinished) upstream.destroy(); });
    req.pipe(upstream);
  });
  server.on('upgrade', (req, socket, head) => {
    const trace = tracker.begin(req, 'websocket');
    socket.once('close', () => trace.end('complete'));
    if ((req.url || '').split('?')[0] !== '/v1/stream' || !ready()) {
      trace.end('rejected', { status: 404 });
      socket.end(`HTTP/1.1 404 Not Found\r\nX-Request-ID: ${trace.id}\r\nConnection: close\r\n\r\n`);
      return;
    }
    // Backend still validates Origin, the single-use ticket, and replay cursor.
    trace.phase('upstream_start', 'backend');
    const upstream = request({
      hostname: '127.0.0.1', port: ports.backend, path: req.url, headers: headersFor(req, trace.id),
    });
    const deadline = setTimeout(() => { trace.end('upgrade_timeout'); upstream.destroy(); }, 10_000);
    upstream.on('upgrade', (response, peer, upstreamHead) => {
      clearTimeout(deadline);
      trace.established();
      socket.write(`HTTP/1.1 ${response.statusCode} ${response.statusMessage}\r\n`);
      socket.write(`X-Request-ID: ${trace.id}\r\n`);
      for (let i = 0; i < response.rawHeaders.length; i += 2) {
        if (response.rawHeaders[i].toLowerCase() === 'x-request-id') continue;
        socket.write(`${response.rawHeaders[i]}: ${response.rawHeaders[i + 1]}\r\n`);
      }
      socket.write('\r\n');
      if (upstreamHead.length) socket.write(upstreamHead);
      if (head.length) peer.write(head);
      socket.pipe(peer).pipe(socket);
      socket.on('error', (error) => { trace.error('websocket.client_error', error); peer.destroy(); });
      peer.on('error', (error) => { trace.error('websocket.upstream_error', error); socket.destroy(); });
      socket.on('close', () => peer.destroy());
      peer.on('close', () => socket.destroy());
    });
    upstream.on('response', (response) => {
      clearTimeout(deadline);
      trace.end('rejected', { status: response.statusCode || 502 });
      socket.end(`HTTP/1.1 ${response.statusCode || 502} Rejected\r\nConnection: close\r\n\r\n`);
      response.resume();
    });
    upstream.on('error', (error) => {
      clearTimeout(deadline); trace.error('websocket.upstream_error', error);
      trace.end('upstream_error'); socket.destroy();
    });
    socket.on('error', (error) => { trace.error('websocket.client_error', error); upstream.destroy(); });
    upstream.end();
  });
  server.requestTimeout = 120_000;
  server.headersTimeout = 15_000;
  server.diagnosticsSnapshot = tracker.snapshot;
  server.once('close', tracker.close);
  return server;
}
