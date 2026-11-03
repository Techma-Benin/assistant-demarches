// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { proxyToOperator } from '@/server/operator-proxy';
import { GET as routeGet, DELETE as routeDelete, POST as routePost, PUT as routePut } from '@/app/api/operator/[...path]/route';

const requireRole = vi.fn();
vi.mock('@/server/auth/tokens', () => ({ requireRole: (role: string) => requireRole(role) }));
vi.mock('@/server/auth/config', () => ({ getAuthConfig: () => ({ backendUrl: 'http://backend:4010' }) }));

const TRACE = '00-' + 'a'.repeat(32) + '-' + 'b'.repeat(16) + '-01';

function setup() {
  const upstream = vi.fn(async (..._args: [URL, RequestInit]) => Response.json({ items: [], nextCursor: null }));
  const run = (method: string, path: string, init: RequestInit & { json?: unknown } = {}) => {
    const headers = new Headers(init.headers);
    if (init.json !== undefined) headers.set('content-type', 'application/json');
    return proxyToOperator(
      new Request(`http://app.test/api/operator/${path}`, {
        method,
        headers,
        body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
      }),
      path.split('?')[0].split('/'),
      { backendUrl: 'http://backend:4010', token: 'tok-operator', fetch: upstream as unknown as typeof fetch },
    );
  };
  return { upstream, run };
}

describe('proxyToOperator allowlist', () => {
  const allowed: [string, string, boolean][] = [
    ['GET', 'v1/operator/models', false],
    ['POST', 'v1/operator/models', true],
    ['GET', 'v1/operator/models/m1', false],
    ['PUT', 'v1/operator/models/m1', true],
    ['DELETE', 'v1/operator/models/m1', false],
    ['GET', 'v1/operator/mcp-servers', false],
    ['POST', 'v1/operator/mcp-servers', true],
    ['GET', 'v1/operator/mcp-servers/s1', false],
    ['PUT', 'v1/operator/mcp-servers/s1', true],
    ['DELETE', 'v1/operator/mcp-servers/s1', false],
    ['POST', 'v1/operator/mcp-servers/s1/discover', false],
    ['GET', 'v1/operator/mcp-servers/s1/tools', false],
    ['PUT', 'v1/operator/mcp-servers/s1/tools/request.submit', true],
    ['GET', 'v1/operator/status', false],
  ];

  it.each(allowed)('forwards %s /%s with the operator bearer', async (method, path, body) => {
    const { upstream, run } = setup();
    const response = await run(method, path, { json: body ? { a: 1 } : undefined, headers: { traceparent: TRACE } });
    expect(response.status).toBe(200);
    const [url, init] = upstream.mock.calls[0];
    expect(url.pathname).toBe('/' + path);
    expect(init.method).toBe(method);
    const headers = init.headers as Headers;
    expect(headers.get('authorization')).toBe('Bearer tok-operator');
    expect(headers.get('traceparent')).toBe(TRACE);
    expect(response.headers.get('authorization')).toBeNull();
  });

  it.each([
    ['DELETE', 'v1/operator/status'],
    ['POST', 'v1/operator/status'],
    ['PATCH', 'v1/operator/models/m1'],
    ['GET', 'v1/operator/models/m1/extra'],
    ['PUT', 'v1/operator/mcp-servers'],
    ['GET', 'v1/operator/mcp-servers/s1/discover'],
    ['POST', 'v1/operator/mcp-servers/s1/tools'],
    ['GET', 'v1/operator/mcp-servers/s1/tools/x'],
    ['DELETE', 'v1/operator/mcp-servers/s1/tools/x'],
    ['GET', 'v1/operator/models/m1/tools'],
    ['GET', 'v1/admin/models'],
    ['GET', 'v1/models'],
    ['GET', 'v1/operator'],
    ['GET', 'v1/operator/unknown'],
    ['GET', 'v1/operator/models/a%2Fb'],
    ['GET', 'v1/operator/models/..'],
    ['GET', 'v1/operator/models/' + 'x'.repeat(81)],
  ])('answers 404 for %s /%s', async (method, path) => {
    const { upstream, run } = setup();
    const response = await run(method, path, { json: method === 'GET' ? undefined : {} });
    expect(response.status).toBe(404);
    expect((await response.json()).code).toBe('NOT_FOUND');
    expect(upstream).not.toHaveBeenCalled();
  });

  it('keeps only cursor and limit on lists and refuses other parameters', async () => {
    const { upstream, run } = setup();
    expect((await run('GET', 'v1/operator/models?cursor=abc&limit=10')).status).toBe(200);
    expect(upstream.mock.calls[0][0].search).toBe('?cursor=abc&limit=10');
    expect((await run('GET', 'v1/operator/models?limit=0')).status).toBe(400);
    expect((await run('GET', 'v1/operator/models?limit=5&limit=6')).status).toBe(400);
    expect((await run('GET', 'v1/operator/models/m1?x=1')).status).toBe(400);
  });

  it('refuses a non-JSON body and a body above the cap', async () => {
    const { upstream, run } = setup();
    const notJson = await run('POST', 'v1/operator/models', { body: 'x', headers: { 'content-type': 'text/plain' } });
    expect(notJson.status).toBe(415);
    const big = await run('POST', 'v1/operator/models', { json: { pad: 'x'.repeat(70 * 1024) } });
    expect(big.status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('passes the backend problem through and maps a network failure to 503', async () => {
    const { upstream, run } = setup();
    upstream.mockResolvedValueOnce(
      new Response('{"code":"CONFLICT","detail":"Modèle actif"}', { status: 409, headers: { 'content-type': 'application/problem+json', 'x-secret': 'no' } }),
    );
    const conflict = await run('DELETE', 'v1/operator/models/m1');
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ code: 'CONFLICT' });
    expect(conflict.headers.get('x-secret')).toBeNull();
    upstream.mockRejectedValueOnce(new Error('down'));
    expect((await run('GET', 'v1/operator/status')).status).toBe(503);
  });

  it('relays 204 without a body', async () => {
    const { upstream, run } = setup();
    upstream.mockResolvedValueOnce(new Response(null, { status: 204 }));
    expect((await run('DELETE', 'v1/operator/models/m1')).status).toBe(204);
  });
});

describe('route handler role gate', () => {
  const upstream = vi.fn();
  beforeEach(() => {
    requireRole.mockReset();
    upstream.mockReset().mockResolvedValue(Response.json({ model: null, mcpServers: [], administrations: [] }));
    vi.stubGlobal('fetch', upstream);
  });
  afterEach(() => vi.unstubAllGlobals());

  const call = (handler: typeof routeGet, method = 'GET') =>
    handler(new Request('http://app.test/api/operator/v1/operator/status', { method }), {
      params: Promise.resolve({ path: ['v1', 'operator', 'status'] }),
    });

  it('answers 401 problem+json without a session and never calls the backend', async () => {
    requireRole.mockResolvedValue({ ok: false, reason: 'unauthenticated' });
    const response = await call(routeGet);
    expect(response.status).toBe(401);
    expect(response.headers.get('content-type')).toContain('application/problem+json');
    expect((await response.json()).code).toBe('UNAUTHORIZED');
    expect(requireRole).toHaveBeenCalledWith('operator');
    expect(upstream).not.toHaveBeenCalled();
  });

  it('answers 403 problem+json for another role', async () => {
    requireRole.mockResolvedValue({ ok: false, reason: 'forbidden' });
    const response = await call(routeGet);
    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe('FORBIDDEN');
    expect(upstream).not.toHaveBeenCalled();
  });

  it('forwards with the session token and exposes all four methods', async () => {
    requireRole.mockResolvedValue({ ok: true, token: 'tok-operator' });
    const response = await call(routeGet);
    expect(response.status).toBe(200);
    const [url, init] = upstream.mock.calls[0];
    expect(String(url)).toBe('http://backend:4010/v1/operator/status');
    expect((init.headers as Headers).get('authorization')).toBe('Bearer tok-operator');
    expect(await response.text()).not.toContain('tok-operator');
    for (const handler of [routePut, routePost, routeDelete]) expect(handler).toBe(routeGet);
  });
});
