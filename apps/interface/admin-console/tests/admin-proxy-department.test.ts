// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { proxyToAdmin } from '@/server/admin-proxy';

const TRACE = '00-' + 'a'.repeat(32) + '-' + 'b'.repeat(16) + '-01';

function setup(upstream?: () => Promise<Response>) {
  const fake = vi.fn(upstream ?? (async () => new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } })));
  const deps = { backendUrl: 'http://127.0.0.1:4010', getAdminToken: () => 'tok', fetch: fake as unknown as typeof fetch };
  return { fake, deps };
}

const call = (method: string, query = '', headers: Record<string, string> = {}, body?: BodyInit) =>
  new Request(`http://localhost/api/admin/x${query}`, { method, headers: { traceparent: TRACE, ...headers }, body });
const KEY = { 'idempotency-key': 'key-12345678', 'content-type': 'application/json' };

afterEach(() => vi.restoreAllMocks());

describe('department routes: GET allowlist', () => {
  const cases: Array<[string, string[], string, string]> = [
    ['me', ['v1', 'admin', 'me'], '', '/v1/admin/me'],
    ['departments', ['v1', 'admin', 'departments'], '?limit=100&cursor=c', '/v1/admin/departments?limit=100&cursor=c'],
    ['users', ['v1', 'admin', 'users'], '?departmentId=justice&limit=5', '/v1/admin/users?departmentId=justice&limit=5'],
    ['work-items', ['v1', 'admin', 'work-items'], '?departmentId=justice&status=pending&limit=100', '/v1/admin/work-items?departmentId=justice&status=pending&limit=100'],
    ['work-item', ['v1', 'admin', 'work-items', 'wi 1'], '', '/v1/admin/work-items/wi%201'],
    ['dashboard', ['v1', 'admin', 'dashboard'], '?departmentId=justice&from=2026-01-01T00:00:00Z&to=2026-02-01', '/v1/admin/dashboard?departmentId=justice&from=2026-01-01T00%3A00%3A00Z&to=2026-02-01'],
    ['activity', ['v1', 'admin', 'activity'], '?departmentId=justice', '/v1/admin/activity?departmentId=justice'],
    ['unanswered', ['v1', 'admin', 'unanswered'], '?departmentId=justice&limit=1', '/v1/admin/unanswered?departmentId=justice&limit=1'],
  ];
  for (const [name, path, query, target] of cases) {
    it(`forwards ${name}`, async () => {
      const { fake, deps } = setup();
      const response = await proxyToAdmin(call('GET', query), path, deps);
      expect(response.status).toBe(200);
      const [url, init] = fake.mock.calls[0] as unknown as [URL, RequestInit];
      expect(url.toString()).toBe(`http://127.0.0.1:4010${target}`);
      expect((init.headers as Headers).get('authorization')).toBe('Bearer tok');
    });
  }

  it('rejects unknown, repeated and invalid query parameters with 400', async () => {
    const { fake, deps } = setup();
    const bad: Array<[string[], string]> = [
      [['v1', 'admin', 'me'], '?departmentId=justice'],
      [['v1', 'admin', 'departments'], '?departmentId=justice'],
      [['v1', 'admin', 'work-items'], '?status=bogus'],
      [['v1', 'admin', 'work-items'], '?status=pending&status=all'],
      [['v1', 'admin', 'work-items'], '?limit=0'],
      [['v1', 'admin', 'work-items'], '?limit=101'],
      [['v1', 'admin', 'work-items'], '?departmentId=a/b'],
      [['v1', 'admin', 'work-items'], '?x=1'],
      [['v1', 'admin', 'work-items'], '?cursor='],
      [['v1', 'admin', 'work-items', 'a'], '?x=1'],
      [['v1', 'admin', 'dashboard'], '?from=yesterday'],
      [['v1', 'admin', 'dashboard'], '?to=2026-13-45'],
      [['v1', 'admin', 'dashboard'], '?limit=5'],
      [['v1', 'admin', 'activity'], '?status=pending'],
      [['v1', 'admin', 'unanswered'], '?from=2026-01-01'],
      [['v1', 'admin', 'work-items', 'a', 'documents', 'f'], '?x=1'],
    ];
    for (const [path, query] of bad) {
      const response = await proxyToAdmin(call('GET', query), path, deps);
      expect(response.status, `${path.join('/')}${query}`).toBe(400);
      expect((await response.json()).code).toBe('INVALID_REQUEST');
    }
    expect(fake).not.toHaveBeenCalled();
  });

  it('accepts every status', async () => {
    const { deps } = setup();
    for (const status of ['pending', 'completed', 'draft', 'all']) {
      expect((await proxyToAdmin(call('GET', `?status=${status}`), ['v1', 'admin', 'work-items'], deps)).status).toBe(200);
    }
  });

  it('keeps 404 for unlisted department routes and methods', async () => {
    const { fake, deps } = setup();
    const cases: Array<[string, string[]]> = [
      ['POST', ['v1', 'admin', 'departments']],
      ['PUT', ['v1', 'admin', 'me']],
      ['PUT', ['v1', 'admin', 'departments', 'x']],
      ['POST', ['v1', 'admin', 'users']],
      ['GET', ['v1', 'admin', 'me', 'x']],
      ['GET', ['v1', 'admin', 'work-items', 'a', 'actions']],
      ['POST', ['v1', 'admin', 'work-items', 'a']],
      ['GET', ['v1', 'admin', 'unanswered', 'a', 'resolve']],
      ['GET', ['v1', 'admin', 'work-items', 'x'.repeat(129)]],
      ['GET', ['v1', 'admin', 'work-items', '..', 'actions']],
    ];
    for (const [method, path] of cases) {
      const response = await proxyToAdmin(call(method, '', KEY, method === 'GET' ? undefined : '{}'), path, deps);
      expect(response.status, `${method} /${path.join('/')}`).toBe(404);
    }
    expect(fake).not.toHaveBeenCalled();
  });
});

describe('department routes: POST', () => {
  it('forwards actions with body and Idempotency-Key', async () => {
    const { fake, deps } = setup();
    const body = '{"action":"approve","revision":2}';
    const response = await proxyToAdmin(call('POST', '', KEY, body), ['v1', 'admin', 'work-items', 'wi-1', 'actions'], deps);
    expect(response.status).toBe(200);
    const [url, init] = fake.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.toString()).toBe('http://127.0.0.1:4010/v1/admin/work-items/wi-1/actions');
    expect(init.method).toBe('POST');
    expect(Buffer.from(init.body as ArrayBuffer).toString()).toBe(body);
    const headers = init.headers as Headers;
    expect(headers.get('idempotency-key')).toBe('key-12345678');
    expect(headers.get('authorization')).toBe('Bearer tok');
  });

  it('forwards unanswered resolve', async () => {
    const { fake, deps } = setup();
    await proxyToAdmin(call('POST', '', KEY, '{}'), ['v1', 'admin', 'unanswered', 'u 1', 'resolve'], deps);
    expect((fake.mock.calls[0] as unknown as [URL])[0].toString()).toBe('http://127.0.0.1:4010/v1/admin/unanswered/u%201/resolve');
  });

  it('requires an Idempotency-Key of 8 to 128 characters', async () => {
    const { fake, deps } = setup();
    for (const key of [undefined, 'short', 'k'.repeat(129)]) {
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (key) headers['idempotency-key'] = key;
      const response = await proxyToAdmin(call('POST', '', headers, '{}'), ['v1', 'admin', 'work-items', 'a', 'actions'], deps);
      expect(response.status).toBe(400);
    }
    expect(fake).not.toHaveBeenCalled();
  });

  it('caps the body at 64 KiB and drops query parameters check', async () => {
    const { fake, deps } = setup();
    const path = ['v1', 'admin', 'work-items', 'a', 'actions'];
    expect((await proxyToAdmin(call('POST', '', KEY, 'x'.repeat(65 * 1024)), path, deps)).status).toBe(400);
    expect((await proxyToAdmin(call('POST', '', { ...KEY, 'content-length': '65537' }, 'x'), path, deps)).status).toBe(400);
    expect((await proxyToAdmin(call('POST', '?x=1', KEY, '{}'), path, deps)).status).toBe(400);
    expect(fake).not.toHaveBeenCalled();
  });
});

describe('department routes: documents', () => {
  const path = ['v1', 'admin', 'work-items', 'wi-1', 'documents', 'file 1'];

  it('streams the document with content-type and content-disposition', async () => {
    const { fake, deps } = setup(async () =>
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: {
          'content-type': 'application/pdf',
          'content-disposition': 'attachment; filename="a.pdf"',
          'content-length': '3',
          'set-cookie': 'x=1',
        },
      }),
    );
    const response = await proxyToAdmin(call('GET'), path, deps);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/pdf');
    expect(response.headers.get('content-disposition')).toBe('attachment; filename="a.pdf"');
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    expect((fake.mock.calls[0] as unknown as [URL])[0].toString()).toBe(
      'http://127.0.0.1:4010/v1/admin/work-items/wi-1/documents/file%201',
    );
  });

  it('refuses a declared size above the cap', async () => {
    const { deps } = setup(async () =>
      new Response('x', { headers: { 'content-type': 'application/pdf', 'content-length': String(26 * 1024 * 1024) } }),
    );
    expect((await proxyToAdmin(call('GET'), path, deps)).status).toBe(502);
  });

  it('errors the stream when the real size exceeds the cap', async () => {
    const chunk = new Uint8Array(8 * 1024 * 1024);
    let sent = 0;
    const { deps } = setup(async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            if (sent++ >= 5) controller.close();
            else controller.enqueue(chunk);
          },
        }),
        { headers: { 'content-type': 'application/pdf' } },
      ),
    );
    const response = await proxyToAdmin(call('GET'), path, deps);
    await expect(response.arrayBuffer()).rejects.toThrow();
  });

  it('passes upstream errors through as problem+json', async () => {
    const { deps } = setup(async () =>
      new Response('{"code":"NOT_FOUND"}', { status: 404, headers: { 'content-type': 'application/problem+json' } }),
    );
    const response = await proxyToAdmin(call('GET'), path, deps);
    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toBe('application/problem+json');
  });
});

describe('department routes: session token', () => {
  it('uses the token provided by the caller for each request', async () => {
    const fake = vi.fn(async () => new Response('{}', { headers: { 'content-type': 'application/json' } }));
    for (const token of ['mock-agent-justice', 'mock-super-admin']) {
      await proxyToAdmin(call('GET'), ['v1', 'admin', 'me'], {
        backendUrl: 'http://127.0.0.1:4010',
        getAdminToken: () => token,
        fetch: fake as unknown as typeof fetch,
      });
    }
    const auth = fake.mock.calls.map((c) => ((c as unknown as [URL, RequestInit])[1].headers as Headers).get('authorization'));
    expect(auth).toEqual(['Bearer mock-agent-justice', 'Bearer mock-super-admin']);
  });
});
