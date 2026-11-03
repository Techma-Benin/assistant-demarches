// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { proxyToAdmin } from '@/server/admin-proxy';

const TRACE = '00-' + 'a'.repeat(32) + '-' + 'b'.repeat(16) + '-01';
const CASE = 'cas_01JD0000000000000000000001';
const DOC = 'doc_01JD0000000000000000000001';
const OFF = 'off_01JD0000000000000000000001';
const UNQ = 'unq_01JD0000000000000000000001';

function setup(upstream?: () => Promise<Response>, getAdminToken = () => 'tok') {
  const fake = vi.fn(
    upstream ??
      (async () =>
        new Response('{"items":[],"nextCursor":null}', {
          status: 200,
          headers: { 'content-type': 'application/json', 'retry-after': '3', 'set-cookie': 'x=1', 'x-secret': 'y' },
        })),
  );
  const deps = { backendUrl: 'http://127.0.0.1:4010', getAdminToken, fetch: fake as unknown as typeof fetch };
  return { fake, deps };
}

const call = (
  method: string,
  path: string,
  options: { headers?: Record<string, string>; body?: BodyInit } = {},
) => {
  const url = new URL(`http://localhost/api/admin${path}`);
  const request = new Request(url, {
    method,
    headers: { traceparent: TRACE, ...options.headers },
    body: method === 'GET' ? undefined : (options.body ?? undefined),
  });
  return { request, segments: url.pathname.replace('/api/admin/', '').split('/') };
};
const run = (deps: ReturnType<typeof setup>['deps'], method: string, path: string, options = {}) => {
  const { request, segments } = call(method, path, options);
  return proxyToAdmin(request, segments, deps);
};

afterEach(() => vi.restoreAllMocks());

describe('v2 routes are forwarded', () => {
  const routes: Array<[string, string, Record<string, unknown>?]> = [
    ['GET', '/v1/admin/me'],
    ['PUT', '/v1/admin/me', { body: '{"displayName":"A","jobTitle":"B"}', headers: { 'content-type': 'application/json' } }],
    ['GET', '/v1/admin/administrations'],
    ['GET', '/v1/admin/officials?administrationId=justice&cursor=c&limit=50'],
    ['POST', '/v1/admin/officials', { body: '{}', headers: { 'content-type': 'application/json' } }],
    ['PUT', `/v1/admin/officials/${OFF}`, { body: '{}', headers: { 'content-type': 'application/json' } }],
    ['GET', '/v1/admin/cases?view=pending&administrationId=justice&cursor=c&limit=20'],
    ['GET', `/v1/admin/cases/${CASE}`],
    ['POST', `/v1/admin/cases/${CASE}/actions`, { body: '{}', headers: { 'idempotency-key': 'abcdefgh' } }],
    ['GET', '/v1/admin/dashboard?administrationId=justice&from=2026-10-01T00:00:00Z&to=2026-11-01T00:00:00Z'],
    ['GET', `/v1/admin/activity?administrationId=justice&caseId=${CASE}&cursor=c&limit=10`],
    ['GET', '/v1/admin/unanswered?administrationId=justice&status=open&cursor=c&limit=10'],
    ['POST', `/v1/admin/unanswered/${UNQ}/resolve`],
  ];
  for (const [method, path, options] of routes) {
    it(`${method} ${path.split('?')[0]}`, async () => {
      const { fake, deps } = setup();
      const response = await run(deps, method, path, options);
      expect(response.status).toBe(200);
      expect(fake).toHaveBeenCalledTimes(1);
      const [url, init] = fake.mock.calls[0] as unknown as [URL, RequestInit];
      expect(url.pathname).toBe(path.split('?')[0]);
      expect(Object.fromEntries(url.searchParams)).toEqual(Object.fromEntries(new URLSearchParams(path.split('?')[1] ?? '')));
      expect(init.method).toBe(method);
    });
  }

  it('injects the session token and forwards only allowed headers, answers without cookies', async () => {
    const { fake, deps } = setup();
    const response = await run(deps, 'GET', '/v1/admin/me', {
      headers: { authorization: 'Bearer browser', cookie: 'session=1', 'x-other': 'no', 'idempotency-key': 'abcdefgh' },
    });
    expect(response.headers.get('retry-after')).toBe('3');
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(response.headers.get('x-secret')).toBeNull();
    const headers = (fake.mock.calls[0] as unknown as [URL, RequestInit])[1].headers as Headers;
    expect(headers.get('authorization')).toBe('Bearer tok');
    expect(headers.get('cookie')).toBeNull();
    expect(headers.get('x-other')).toBeNull();
    expect(headers.get('traceparent')).toBe(TRACE);
    expect(headers.get('idempotency-key')).toBe('abcdefgh');
  });
});

describe('everything else is 404', () => {
  it('rejects v1 routes, removed routes, other methods and malformed ids', async () => {
    const { fake, deps } = setup();
    const cases: Array<[string, string]> = [
      ['GET', '/v1/admin/departments'],
      ['GET', '/v1/admin/users'],
      ['GET', '/v1/admin/work-items?status=pending'],
      ['GET', `/v1/admin/work-items/${CASE}`],
      ['POST', `/v1/admin/work-items/${CASE}/actions`],
      ['GET', '/v1/admin/models'],
      ['GET', '/v1/admin/metrics'],
      ['PUT', '/v1/admin/procedures/PS00373'],
      ['GET', '/v1/conversations'],
      ['GET', '/v1/admin'],
      ['DELETE', `/v1/admin/officials/${OFF}`],
      ['PUT', '/v1/admin/cases'],
      ['POST', '/v1/admin/cases'],
      ['GET', `/v1/admin/officials/${OFF}`],
      ['GET', '/v1/admin/cases/not-an-id'],
      ['GET', `/v1/admin/cases/${CASE}/documents/${CASE}`],
      ['GET', '/v1/admin/avatars/justice'],
      ['POST', '/v1/admin/unanswered/abc/resolve'],
    ];
    for (const [method, path] of cases) {
      const response = await run(deps, method, path, { body: method === 'GET' ? undefined : '{}' });
      expect(response.status, `${method} ${path}`).toBe(404);
      expect(response.headers.get('content-type')).toBe('application/problem+json');
      expect(await response.json()).toMatchObject({ code: 'NOT_FOUND', status: 404, traceId: 'a'.repeat(32) });
    }
    expect(fake).not.toHaveBeenCalled();
  });

  it('rejects traversal and encoded slashes', async () => {
    const { fake, deps } = setup();
    for (const path of [
      ['v1', 'admin', '..', 'me'],
      ['v1', 'admin', 'cases', 'a/b'],
      ['v1', 'admin', 'cases', 'a%2Fb'],
      ['v1', 'admin', 'cases', ''],
    ]) {
      const { request } = call('GET', '/v1/admin/me');
      expect((await proxyToAdmin(request, path, deps)).status).toBe(404);
    }
    expect(fake).not.toHaveBeenCalled();
  });

  it('uses a zero traceId without incoming traceparent', async () => {
    const { deps } = setup();
    const response = await proxyToAdmin(new Request('http://localhost/x'), ['v1', 'admin', 'nope'], deps);
    expect((await response.json()).traceId).toBe('0'.repeat(32));
  });
});

describe('query parameters', () => {
  it('rejects the v1 departmentId, unknown, repeated and invalid parameters with 400', async () => {
    const { fake, deps } = setup();
    const bad = [
      '/v1/admin/cases?view=pending&departmentId=justice',
      '/v1/admin/cases?view=pending&status=pending',
      '/v1/admin/cases?view=submitted',
      '/v1/admin/cases?view=pending&view=all',
      '/v1/admin/cases?view=pending&limit=0',
      '/v1/admin/cases?view=pending&limit=101',
      '/v1/admin/cases?view=pending&limit=abc',
      '/v1/admin/cases?view=pending&administrationId=Justice',
      '/v1/admin/cases?view=pending&cursor=',
      `/v1/admin/cases?view=pending&cursor=${'x'.repeat(4097)}`,
      '/v1/admin/me?x=1',
      `/v1/admin/cases/${CASE}?x=1`,
      '/v1/admin/officials?view=pending',
      '/v1/admin/dashboard?from=yesterday',
      '/v1/admin/activity?caseId=abc',
      '/v1/admin/unanswered?status=pending',
      `/v1/admin/unanswered/${UNQ}/resolve?x=1`,
      `/v1/admin/cases/${CASE}/documents/${DOC}?x=1`,
      `/v1/admin/avatars/${OFF}?v=2`,
    ];
    for (const path of bad) {
      const response = await run(deps, path.includes('/resolve') ? 'POST' : 'GET', path);
      expect(response.status, path).toBe(400);
      expect(await response.json()).toMatchObject({ code: 'INVALID_REQUEST' });
    }
    expect(fake).not.toHaveBeenCalled();
  });

  it('requires view on the case list', async () => {
    const { deps } = setup();
    expect((await run(deps, 'GET', '/v1/admin/cases')).status).toBe(400);
    expect((await run(deps, 'GET', '/v1/admin/cases?limit=20')).status).toBe(400);
  });

  it('accepts every view, status and the limit bounds', async () => {
    const { deps } = setup();
    for (const view of ['pending', 'completed', 'rejected', 'all']) {
      expect((await run(deps, 'GET', `/v1/admin/cases?view=${view}&limit=1`)).status).toBe(200);
    }
    expect((await run(deps, 'GET', '/v1/admin/cases?view=all&limit=100')).status).toBe(200);
    for (const status of ['open', 'resolved']) {
      expect((await run(deps, 'GET', `/v1/admin/unanswered?status=${status}`)).status).toBe(200);
    }
    expect((await run(deps, 'GET', `/v1/admin/cases?view=all&cursor=${'x'.repeat(4096)}`)).status).toBe(200);
  });
});

describe('cases/actions and Idempotency-Key', () => {
  it('forwards the JSON body and key unchanged', async () => {
    const { fake, deps } = setup();
    await run(deps, 'POST', `/v1/admin/cases/${CASE}/actions`, {
      body: '{"action":"reject","note":"Pièce illisible"}',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'act-key-12345' },
    });
    const [, init] = fake.mock.calls[0] as unknown as [URL, RequestInit];
    expect(Buffer.from(init.body as ArrayBuffer).toString()).toBe('{"action":"reject","note":"Pièce illisible"}');
    expect((init.headers as Headers).get('idempotency-key')).toBe('act-key-12345');
    expect((init.headers as Headers).get('content-type')).toBe('application/json');
  });

  it('requires a key of 8 to 128 characters', async () => {
    const { fake, deps } = setup();
    for (const key of [undefined, 'short', 'x'.repeat(129)]) {
      const response = await run(deps, 'POST', `/v1/admin/cases/${CASE}/actions`, {
        body: '{}',
        headers: key ? { 'idempotency-key': key } : {},
      });
      expect(response.status).toBe(400);
    }
    expect(fake).not.toHaveBeenCalled();
    expect((await run(deps, 'POST', `/v1/admin/cases/${CASE}/actions`, { body: '{}', headers: { 'idempotency-key': 'x'.repeat(128) } })).status).toBe(200);
  });

  it('does not require a key to resolve an unanswered question or create an official', async () => {
    const { deps } = setup();
    expect((await run(deps, 'POST', `/v1/admin/unanswered/${UNQ}/resolve`)).status).toBe(200);
    expect((await run(deps, 'POST', '/v1/admin/officials', { body: '{}' })).status).toBe(200);
  });
});

describe('JSON body limit', () => {
  it('returns 400 from content-length and from the actual body, without calling fetch', async () => {
    const { fake, deps } = setup();
    const big = 'x'.repeat(64 * 1024 + 1);
    expect((await run(deps, 'PUT', '/v1/admin/me', { body: big, headers: { 'content-length': String(big.length) } })).status).toBe(400);
    expect((await run(deps, 'PUT', '/v1/admin/me', { body: big })).status).toBe(400);
    expect(fake).not.toHaveBeenCalled();
  });

  it('stops reading a streamed body without content-length once over the limit', async () => {
    const { fake, deps } = setup();
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(new Uint8Array(16 * 1024));
        if (pulled > 100) controller.close();
      },
    });
    const request = new Request('http://localhost/api/admin/v1/admin/me', {
      method: 'PUT',
      headers: { traceparent: TRACE },
      body: stream,
      duplex: 'half',
    } as RequestInit);
    expect((await proxyToAdmin(request, ['v1', 'admin', 'me'], deps)).status).toBe(400);
    expect(pulled).toBeLessThan(10);
    expect(fake).not.toHaveBeenCalled();
  });
});

describe('avatar upload', () => {
  const image = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

  it('forwards the raw body and X-File-Mime-Type', async () => {
    const { fake, deps } = setup();
    const response = await run(deps, 'PUT', '/v1/admin/me/avatar', {
      body: image,
      headers: { 'content-type': 'application/octet-stream', 'x-file-mime-type': 'image/jpeg' },
    });
    expect(response.status).toBe(200);
    const [url, init] = fake.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.pathname).toBe('/v1/admin/me/avatar');
    expect(init.method).toBe('PUT');
    expect(new Uint8Array(init.body as ArrayBuffer)).toEqual(image);
    const headers = init.headers as Headers;
    expect(headers.get('x-file-mime-type')).toBe('image/jpeg');
    expect(headers.get('content-type')).toBe('application/octet-stream');
  });

  it('refuses a missing or non-image mime type (415) without calling fetch', async () => {
    const { fake, deps } = setup();
    for (const headers of [{}, { 'x-file-mime-type': 'image/gif' }, { 'x-file-mime-type': 'application/pdf' }]) {
      expect((await run(deps, 'PUT', '/v1/admin/me/avatar', { body: image, headers })).status).toBe(415);
    }
    expect(fake).not.toHaveBeenCalled();
  });

  it('refuses more than 2 Mio (413)', async () => {
    const { fake, deps } = setup();
    const big = new Uint8Array(2 * 1024 * 1024 + 1);
    const headers = { 'x-file-mime-type': 'image/png' };
    expect((await run(deps, 'PUT', '/v1/admin/me/avatar', { body: big, headers })).status).toBe(413);
    expect((await run(deps, 'PUT', '/v1/admin/me/avatar', { body: big, headers: { ...headers, 'content-length': String(big.length) } })).status).toBe(413);
    expect(fake).not.toHaveBeenCalled();
  });
});

describe('binary responses', () => {
  const pdf = () =>
    new Response(new Uint8Array([37, 80, 68, 70]), {
      status: 200,
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': 'attachment; filename="extrait.pdf"',
        'content-length': '4',
        'set-cookie': 'x=1',
      },
    });

  it('streams a document with content-type, disposition and length', async () => {
    const { fake, deps } = setup(async () => pdf());
    const response = await run(deps, 'GET', `/v1/admin/cases/${CASE}/documents/${DOC}`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/pdf');
    expect(response.headers.get('content-disposition')).toBe('attachment; filename="extrait.pdf"');
    expect(response.headers.get('content-length')).toBe('4');
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([37, 80, 68, 70]));
    expect((fake.mock.calls[0] as unknown as [URL])[0].pathname).toBe(`/v1/admin/cases/${CASE}/documents/${DOC}`);
  });

  it('streams an avatar image', async () => {
    const { deps } = setup(async () => new Response(new Uint8Array([1, 2]), { headers: { 'content-type': 'image/png', 'content-length': '2' } }));
    const response = await run(deps, 'GET', `/v1/admin/avatars/${OFF}`);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2]));
  });

  it('refuses a declared size above the cap and errors the stream when the real size exceeds it', async () => {
    const declared = setup(async () => new Response('x', { headers: { 'content-type': 'application/pdf', 'content-length': String(26 * 1024 * 1024) } }));
    expect((await run(declared.deps, 'GET', `/v1/admin/cases/${CASE}/documents/${DOC}`)).status).toBe(502);

    const chunk = new Uint8Array(1024 * 1024);
    let sent = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent += 1;
        controller.enqueue(chunk);
        if (sent > 40) controller.close();
      },
    });
    const real = setup(async () => new Response(endless, { headers: { 'content-type': 'application/pdf' } }));
    const response = await run(real.deps, 'GET', `/v1/admin/cases/${CASE}/documents/${DOC}`);
    await expect(response.arrayBuffer()).rejects.toThrow();
  });

  it('caps avatars at 2 Mio', async () => {
    const { deps } = setup(async () => new Response('x', { headers: { 'content-type': 'image/png', 'content-length': String(3 * 1024 * 1024) } }));
    expect((await run(deps, 'GET', `/v1/admin/avatars/${OFF}`)).status).toBe(502);
  });

  it('passes upstream errors through as problem+json', async () => {
    const { deps } = setup(async () =>
      new Response('{"code":"NOT_FOUND"}', { status: 404, headers: { 'content-type': 'application/problem+json' } }),
    );
    const response = await run(deps, 'GET', `/v1/admin/cases/${CASE}/documents/${DOC}`);
    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toBe('application/problem+json');
    expect(await response.json()).toEqual({ code: 'NOT_FOUND' });
  });
});

describe('failures', () => {
  it('returns 503 without leaking the cause when the token is unavailable, and never logs it', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { fake, deps } = setup(undefined, () => {
      throw new Error('secret-detail');
    });
    const response = await run(deps, 'GET', '/v1/admin/me');
    expect(response.status).toBe(503);
    expect(response.headers.get('retry-after')).toBe('1');
    expect(JSON.stringify(await response.json())).not.toContain('secret-detail');
    expect(fake).not.toHaveBeenCalled();
    expect(JSON.stringify(spy.mock.calls)).not.toContain('Bearer');
  });

  it('returns 503 UPSTREAM_UNAVAILABLE when upstream fails', async () => {
    const { deps } = setup(async () => {
      throw new TypeError('connect ECONNREFUSED');
    });
    const response = await run(deps, 'GET', '/v1/admin/me');
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: 'UPSTREAM_UNAVAILABLE' });
  });

  it('returns upstream status, body and content-type unchanged (409 INVALID_TRANSITION)', async () => {
    const body = '{"code":"INVALID_TRANSITION","detail":"Déjà complété"}';
    const { deps } = setup(async () => new Response(body, { status: 409, headers: { 'content-type': 'application/problem+json' } }));
    const response = await run(deps, 'POST', `/v1/admin/cases/${CASE}/actions`, { body: '{}', headers: { 'idempotency-key': 'abcdefgh' } });
    expect(response.status).toBe(409);
    expect(await response.text()).toBe(body);
  });

  it('uses the token provided by the caller for each request', async () => {
    let token = 'one';
    const { fake, deps } = setup(undefined, () => token);
    await run(deps, 'GET', '/v1/admin/me');
    token = 'two';
    await run(deps, 'GET', '/v1/admin/me');
    const auth = fake.mock.calls.map((c) => ((c as unknown as [URL, RequestInit])[1].headers as Headers).get('authorization'));
    expect(auth).toEqual(['Bearer one', 'Bearer two']);
  });
});
