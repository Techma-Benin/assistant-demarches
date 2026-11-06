import { createServer, request } from 'node:http';

/** One public listener; application, identity-provider, and backend ports remain private. */
export function createGateway({ origin, ports, ready = () => true }) {
  const publicUrl = new URL(origin);
  const headersFor = (req) => ({
    ...req.headers,
    host: publicUrl.host,
    'x-forwarded-host': publicUrl.host,
    'x-forwarded-proto': publicUrl.protocol.slice(0, -1),
    'x-forwarded-port': publicUrl.port || (publicUrl.protocol === 'https:' ? '443' : '80'),
    'x-forwarded-for': req.socket.remoteAddress,
  });
  const server = createServer((req, res) => {
    // Use the raw path: encoded slashes/dot segments must not bypass the identity route allowlist.
    const path = (req.url || '/').split('?')[0];
    if (path === '/health/ready') {
      res.writeHead(ready() ? 200 : 503, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      return res.end(JSON.stringify({ status: ready() ? 'ok' : 'starting', simulation: true }));
    }
    let port = ports.interface;
    let targetPath = req.url;
    if (path.startsWith('/keycloak')) {
      if (!/^\/keycloak\/(?:realms\/techma(?:\/|$)|resources\/)/.test(path)
          || /%|\\|\/\.\.?(?:\/|$)/i.test(path)) {
        res.writeHead(404); return res.end();
      }
      port = ports.keycloak;
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
    const upstream = request({
      hostname: '127.0.0.1', port, path: targetPath, method: req.method, headers: headersFor(req),
    }, (response) => {
      res.writeHead(response.statusCode || 502, response.headers);
      response.pipe(res);
    });
    upstream.on('error', () => {
      if (!res.headersSent) res.writeHead(502);
      res.end('Upstream unavailable');
    });
    upstream.setTimeout(120_000, () => upstream.destroy());
    req.on('aborted', () => upstream.destroy());
    res.on('close', () => { if (!res.writableFinished) upstream.destroy(); });
    req.pipe(upstream);
  });
  server.on('upgrade', (req, socket, head) => {
    if ((req.url || '').split('?')[0] !== '/v1/stream' || !ready()) {
      socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      return;
    }
    // Backend still validates Origin, the single-use ticket, and replay cursor.
    const upstream = request({
      hostname: '127.0.0.1', port: ports.backend, path: req.url, headers: headersFor(req),
    });
    const deadline = setTimeout(() => upstream.destroy(), 10_000);
    upstream.on('upgrade', (response, peer, upstreamHead) => {
      clearTimeout(deadline);
      socket.write(`HTTP/1.1 ${response.statusCode} ${response.statusMessage}\r\n`);
      for (let i = 0; i < response.rawHeaders.length; i += 2) {
        socket.write(`${response.rawHeaders[i]}: ${response.rawHeaders[i + 1]}\r\n`);
      }
      socket.write('\r\n');
      if (upstreamHead.length) socket.write(upstreamHead);
      if (head.length) peer.write(head);
      socket.pipe(peer).pipe(socket);
      socket.on('error', () => peer.destroy());
      peer.on('error', () => socket.destroy());
      socket.on('close', () => peer.destroy());
      peer.on('close', () => socket.destroy());
    });
    upstream.on('response', (response) => {
      clearTimeout(deadline);
      socket.end(`HTTP/1.1 ${response.statusCode || 502} Rejected\r\nConnection: close\r\n\r\n`);
      response.resume();
    });
    upstream.on('error', () => { clearTimeout(deadline); socket.destroy(); });
    socket.on('error', () => upstream.destroy());
    upstream.end();
  });
  server.requestTimeout = 120_000;
  server.headersTimeout = 15_000;
  return server;
}
