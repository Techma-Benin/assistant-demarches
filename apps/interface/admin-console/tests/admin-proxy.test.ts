// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Identity } from '@/lib/permissions';
import { proxyToAdmin } from '@/server/admin-proxy';
import { DEMO_SESSION_IDENTITIES } from '@/server/session';

const TRACE = '00-' + 'a'.repeat(32) + '-' + 'b'.repeat(16) + '-01';

const [PLATFORM, ADMIN_WRITE, ADMIN_READ] = DEMO_SESSION_IDENTITIES;

function setup(upstream?: () => Promise<Response>, getAdminToken = () => 'tok', identity: Identity | null = PLATFORM) {
  const fake = vi.fn(upstream ?? (async () => new Response('{"items":[],"nextCursor":null}', {
    status: 200,
    headers: { 'content-type': 'application/json', 'retry-after': '3', 'set-cookie': 'x=1', 'x-secret': 'y' },
  })));
  const deps = { backendUrl: 'http://127.0.0.1:4010', getAdminToken, getIdentity: () => identity, fetch: fake as unknown as typeof fetch };
  return { fake, deps };
}

const get = (query = '') => new Request(`http://localhost/api/admin/x${query}`, { headers: { traceparent: TRACE } });
const put = (body: BodyInit, headers: Record<string, string> = {}) =>
  new Request('http://localhost/api/admin/x', {
    method: 'PUT',
    headers: { 'content-type': 'application/json', traceparent: TRACE, ...headers },
    body,
  });

afterEach(() => vi.restoreAllMocks());

describe('proxyToAdmin allowlist', () => {
  it('forwards list and metrics GETs with injected auth and only allowed headers', async () => {
    const { fake, deps } = setup();
    for (const resource of ['models', 'tools', 'procedures', 'conversations', 'audit', 'metrics']) {
      const request = new Request('http://localhost/api/admin/x', {
        headers: {
          authorization: 'Bearer browser',
          cookie: 'session=1',
          'idempotency-key': 'abcdefgh',
          traceparent: TRACE,
          'x-other': 'no',
        },
      });
      const response = await proxyToAdmin(request, ['v1', 'admin', resource], deps);
      expect(response.status).toBe(200);
      expect(response.headers.get('retry-after')).toBe('3');
      expect(response.headers.get('set-cookie')).toBeNull();
      expect(response.headers.get('x-secret')).toBeNull();
    }
    expect(fake).toHaveBeenCalledTimes(6);
    const [url, init] = fake.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.toString()).toBe('http://127.0.0.1:4010/v1/admin/models');
    const headers = init.headers as Headers;
    expect(headers.get('authorization')).toBe('Bearer tok');
    expect(headers.get('cookie')).toBeNull();
    expect(headers.get('x-other')).toBeNull();
    expect(headers.get('idempotency-key')).toBe('abcdefgh');
    expect(headers.get('traceparent')).toBe(TRACE);
  });

  it('forwards a PUT with re-encoded id, body and headers', async () => {
    const { fake, deps } = setup(async () => new Response('{"id":"a b"}', { status: 200, headers: { 'content-type': 'application/json' } }));
    const response = await proxyToAdmin(put('{"id":"a b"}', { 'idempotency-key': 'abcdefgh' }), ['v1', 'admin', 'procedures', 'a b'], deps);
    expect(response.status).toBe(200);
    const [url, init] = fake.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.toString()).toBe('http://127.0.0.1:4010/v1/admin/procedures/a%20b');
    expect(init.method).toBe('PUT');
    expect(Buffer.from(init.body as ArrayBuffer).toString()).toBe('{"id":"a b"}');
    const headers = init.headers as Headers;
    expect(headers.get('content-type')).toBe('application/json');
    expect(headers.get('idempotency-key')).toBe('abcdefgh');
  });

  it('returns 404 problem+json for anything outside the allowlist', async () => {
    const { fake, deps } = setup();
    const cases: Array<[string, string[]]> = [
      ['GET', ['v1', 'conversations']],
      ['GET', ['v1', 'admin']],
      ['GET', ['v1', 'admin', 'secrets']],
      ['GET', ['v1', 'admin', 'models', 'x']],
      ['GET', ['v1', 'admin', 'metrics', 'x']],
      ['PUT', ['v1', 'admin', 'models', 'x', 'y']],
      ['PUT', ['v1', 'admin', 'models']],
      ['PUT', ['v1', 'admin', 'conversations', 'x']],
      ['PUT', ['v1', 'admin', 'audit', 'x']],
      ['PUT', ['v1', 'admin', 'metrics']],
      ['POST', ['v1', 'admin', 'models']],
      ['DELETE', ['v1', 'admin', 'models', 'x']],
      ['PUT', ['v1', 'admin', 'models', 'x'.repeat(129)]],
    ];
    for (const [method, path] of cases) {
      const response = await proxyToAdmin(
        new Request('http://localhost/x', { method, headers: { traceparent: TRACE }, body: method === 'GET' ? undefined : '{}' }),
        path,
        deps,
      );
      expect(response.status, `${method} /${path.join('/')}`).toBe(404);
      expect(response.headers.get('content-type')).toBe('application/problem+json');
      expect(await response.json()).toMatchObject({ code: 'NOT_FOUND', title: 'NOT_FOUND', status: 404, traceId: 'a'.repeat(32) });
    }
    expect(fake).not.toHaveBeenCalled();
  });

  it('accepts a 128-char id and rejects traversal and encoded slashes', async () => {
    const { fake, deps } = setup();
    expect((await proxyToAdmin(put('{}'), ['v1', 'admin', 'models', 'x'.repeat(128)], deps)).status).toBe(200);
    fake.mockClear();
    for (const path of [
      ['v1', 'admin', 'models', '..'],
      ['v1', 'admin', '..', 'models'],
      ['v1', 'admin', 'models', 'a/b'],
      ['v1', 'admin', 'models', 'a%2Fb'],
      ['v1', 'admin', 'models', ''],
    ]) {
      expect((await proxyToAdmin(put('{}'), path, deps)).status).toBe(404);
    }
    expect(fake).not.toHaveBeenCalled();
  });

  it('uses a zero traceId without incoming traceparent', async () => {
    const { deps } = setup();
    const response = await proxyToAdmin(new Request('http://localhost/x'), ['nope'], deps);
    expect((await response.json()).traceId).toBe('0'.repeat(32));
  });
});

describe('proxyToAdmin list query', () => {
  it('forwards only cursor and limit', async () => {
    const { fake, deps } = setup();
    await proxyToAdmin(get('?cursor=20&limit=50&admin=1&x=2'), ['v1', 'admin', 'audit'], deps);
    const [url] = fake.mock.calls[0] as unknown as [URL];
    expect(url.toString()).toBe('http://127.0.0.1:4010/v1/admin/audit?cursor=20&limit=50');
  });

  it('accepts the limit bounds', async () => {
    const { deps } = setup();
    for (const limit of ['1', '100']) {
      expect((await proxyToAdmin(get(`?limit=${limit}`), ['v1', 'admin', 'models'], deps)).status).toBe(200);
    }
  });

  it('rejects invalid values with 400 INVALID_REQUEST', async () => {
    const { fake, deps } = setup();
    for (const query of [
      '?limit=0',
      '?limit=101',
      '?limit=-1',
      '?limit=1.5',
      '?limit=abc',
      '?limit=',
      '?limit=1&limit=2',
      '?cursor=',
      `?cursor=${'c'.repeat(257)}`,
      '?cursor=a&cursor=b',
    ]) {
      const response = await proxyToAdmin(get(query), ['v1', 'admin', 'models'], deps);
      expect(response.status, query).toBe(400);
      expect(await response.json()).toMatchObject({ code: 'INVALID_REQUEST', title: 'INVALID_REQUEST' });
    }
    expect(fake).not.toHaveBeenCalled();
  });

  it('accepts a 256-char cursor', async () => {
    const { deps } = setup();
    expect((await proxyToAdmin(get(`?cursor=${'c'.repeat(256)}`), ['v1', 'admin', 'models'], deps)).status).toBe(200);
  });

  it('drops any query on metrics and PUT', async () => {
    const { fake, deps } = setup();
    await proxyToAdmin(get('?cursor=1&limit=5&x=1'), ['v1', 'admin', 'metrics'], deps);
    await proxyToAdmin(
      new Request('http://localhost/x?cursor=1&x=1', { method: 'PUT', body: '{}' }),
      ['v1', 'admin', 'tools', 'a'],
      deps,
    );
    expect((fake.mock.calls[0] as unknown as [URL])[0].search).toBe('');
    expect((fake.mock.calls[1] as unknown as [URL])[0].search).toBe('');
  });
});

describe('proxyToAdmin PUT body limit', () => {
  it('returns 400 from content-length without calling fetch', async () => {
    const { fake, deps } = setup();
    const response = await proxyToAdmin(put('x', { 'content-length': '65537' }), ['v1', 'admin', 'models', 'a'], deps);
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe('INVALID_REQUEST');
    expect(fake).not.toHaveBeenCalled();
  });

  it('returns 400 from the actual body size', async () => {
    const { fake, deps } = setup();
    const response = await proxyToAdmin(put('x'.repeat(65 * 1024)), ['v1', 'admin', 'models', 'a'], deps);
    expect(response.status).toBe(400);
    expect(fake).not.toHaveBeenCalled();
  });

  it('stops reading a streamed body without content-length once over the limit', async () => {
    const { fake, deps } = setup();
    const chunk = new Uint8Array(16 * 1024);
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(chunk); // never closes: an endless upload
      },
    });
    const request = new Request('http://localhost/api/admin/x', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', traceparent: TRACE },
      body: stream,
      duplex: 'half',
    } as RequestInit);
    expect(request.headers.get('content-length')).toBeNull();
    const response = await proxyToAdmin(request, ['v1', 'admin', 'models', 'a'], deps);
    expect(response.status).toBe(400);
    expect(pulled).toBeLessThanOrEqual(8);
    expect(fake).not.toHaveBeenCalled();
  });
});

describe('proxyToAdmin failures', () => {
  it('returns 503 without leaking the cause when the token is unavailable', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { fake, deps } = setup(undefined, () => {
      throw new Error('Session OIDC administrateur non branchée');
    });
    const response = await proxyToAdmin(get(), ['v1', 'admin', 'models'], deps);
    expect(response.status).toBe(503);
    expect(response.headers.get('retry-after')).toBe('1');
    const text = await response.text();
    expect(JSON.parse(text).code).toBe('UPSTREAM_UNAVAILABLE');
    expect(text).not.toContain('OIDC');
    expect(error).toHaveBeenCalledWith('[admin-proxy] admin token unavailable:', 'Session OIDC administrateur non branchée');
    expect(fake).not.toHaveBeenCalled();
  });

  it('never logs the token', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { deps } = setup(undefined, () => {
      throw new Error('boom');
    });
    await proxyToAdmin(get(), ['v1', 'admin', 'models'], deps);
    expect(JSON.stringify(error.mock.calls)).not.toContain('Bearer');
  });

  it('returns 503 UPSTREAM_UNAVAILABLE when upstream fails', async () => {
    const { deps } = setup(async () => {
      throw new TypeError('fetch failed');
    });
    const response = await proxyToAdmin(get(), ['v1', 'admin', 'models'], deps);
    expect(response.status).toBe(503);
    expect(response.headers.get('retry-after')).toBe('1');
    expect((await response.json()).code).toBe('UPSTREAM_UNAVAILABLE');
  });

  it('returns upstream status, body and content-type unchanged', async () => {
    const body = '{"type":"about:blank","status":409,"code":"CONFLICT"}';
    const { deps } = setup(async () => new Response(body, { status: 409, headers: { 'content-type': 'application/problem+json' } }));
    const response = await proxyToAdmin(put('{}'), ['v1', 'admin', 'models', 'a'], deps);
    expect(response.status).toBe(409);
    expect(response.headers.get('content-type')).toBe('application/problem+json');
    expect(await response.text()).toBe(body);
  });
});

describe('proxyToAdmin identity enforcement', () => {
  const FORBIDDEN_DETAIL = 'Action non permise avec l’identité active';

  it('returns 401 UNAUTHENTICATED without identity', async () => {
    const { fake, deps } = setup(undefined, undefined, null);
    const response = await proxyToAdmin(get(), ['v1', 'admin', 'models'], deps);
    expect(response.status).toBe(401);
    expect(response.headers.get('content-type')).toBe('application/problem+json');
    expect(await response.json()).toMatchObject({ code: 'UNAUTHENTICATED', detail: 'Session requise' });
    expect(fake).not.toHaveBeenCalled();
  });

  it('refuses a read-only administration PUT on a procedure', async () => {
    const { fake, deps } = setup(undefined, undefined, ADMIN_READ);
    const response = await proxyToAdmin(put('{}'), ['v1', 'admin', 'procedures', 'a'], deps);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: 'FORBIDDEN', detail: FORBIDDEN_DETAIL });
    expect(fake).not.toHaveBeenCalled();
  });

  it('refuses an administration PUT on tools and GET on tools', async () => {
    const { fake, deps } = setup(undefined, undefined, ADMIN_WRITE);
    expect((await proxyToAdmin(put('{}'), ['v1', 'admin', 'tools', 'a'], deps)).status).toBe(403);
    expect((await proxyToAdmin(get(), ['v1', 'admin', 'tools'], deps)).status).toBe(403);
    expect(fake).not.toHaveBeenCalled();
  });

  it('forwards a write administration PUT on a procedure and a platform PUT on models', async () => {
    const admin = setup(undefined, undefined, ADMIN_WRITE);
    expect((await proxyToAdmin(put('{}'), ['v1', 'admin', 'procedures', 'a'], admin.deps)).status).toBe(200);
    expect(admin.fake).toHaveBeenCalledTimes(1);
    const platform = setup(undefined, undefined, PLATFORM);
    expect((await proxyToAdmin(put('{}'), ['v1', 'admin', 'models', 'a'], platform.deps)).status).toBe(200);
    expect(platform.fake).toHaveBeenCalledTimes(1);
  });

  it('lets a read-only administration view procedures and metrics', async () => {
    const { deps } = setup(undefined, undefined, ADMIN_READ);
    expect((await proxyToAdmin(get(), ['v1', 'admin', 'procedures'], deps)).status).toBe(200);
    expect((await proxyToAdmin(get(), ['v1', 'admin', 'metrics'], deps)).status).toBe(200);
  });
});
