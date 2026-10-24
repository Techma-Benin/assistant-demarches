// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { proxyToBackend } from '@/server/backend-proxy';

const CNV = 'cnv_' + '0'.repeat(25) + '1';
const TRACE = '00-' + 'a'.repeat(32) + '-' + 'b'.repeat(16) + '-01';

function setup(upstream?: () => Promise<Response>) {
  const fake = vi.fn(upstream ?? (async () => new Response('{"ok":true}', {
    status: 202,
    headers: { 'content-type': 'application/json', 'retry-after': '3', 'set-cookie': 'x=1', 'x-secret': 'y' },
  })));
  const deps = { backendUrl: 'http://127.0.0.1:4010', getUserToken: () => 'tok', fetch: fake as unknown as typeof fetch };
  return { fake, deps };
}

describe('proxyToBackend', () => {
  it('forwards an allowlisted route with injected auth and only allowed headers', async () => {
    const { fake, deps } = setup();
    const request = new Request(`http://localhost/api/backend/v1/conversations/${CNV}/messages?x=1&y=2`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer browser',
        cookie: 'session=1',
        'content-type': 'application/json',
        'idempotency-key': 'abcdefgh',
        traceparent: TRACE,
        'x-other': 'no',
      },
      body: '{"a":1}',
    });
    const response = await proxyToBackend(request, ['v1', 'conversations', CNV, 'messages'], deps);
    expect(response.status).toBe(202);
    expect(response.headers.get('retry-after')).toBe('3');
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(response.headers.get('x-secret')).toBeNull();
    expect(await response.text()).toBe('{"ok":true}');

    const [url, init] = fake.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.toString()).toBe(`http://127.0.0.1:4010/v1/conversations/${CNV}/messages?x=1&y=2`);
    const headers = init.headers as Headers;
    expect(headers.get('authorization')).toBe('Bearer tok');
    expect(headers.get('cookie')).toBeNull();
    expect(headers.get('x-other')).toBeNull();
    expect(headers.get('idempotency-key')).toBe('abcdefgh');
    expect(headers.get('traceparent')).toBe(TRACE);
    expect(Buffer.from(init.body as ArrayBuffer).toString()).toBe('{"a":1}');
  });

  it('returns 404 problem+json for unknown path or wrong method', async () => {
    const { fake, deps } = setup();
    for (const [method, path] of [
      ['GET', ['v1', 'admin', 'models']],
      ['GET', ['v1', 'conversations']],
      ['POST', ['v1', 'requests', 'req_' + '0'.repeat(26)]],
      ['POST', ['v1', 'conversations', 'cnv_short', 'messages']],
    ] as const) {
      const response = await proxyToBackend(
        new Request('http://localhost/x', { method, headers: { traceparent: TRACE }, body: method === 'POST' ? '{}' : undefined }),
        [...path],
        deps,
      );
      expect(response.status).toBe(404);
      expect(response.headers.get('content-type')).toBe('application/problem+json');
      const body = await response.json();
      expect(body).toMatchObject({ code: 'NOT_FOUND', title: 'NOT_FOUND', status: 404, traceId: 'a'.repeat(32) });
    }
    expect(fake).not.toHaveBeenCalled();
  });

  it('uses a zero traceId without incoming traceparent', async () => {
    const { deps } = setup();
    const response = await proxyToBackend(new Request('http://localhost/x'), ['nope'], deps);
    expect((await response.json()).traceId).toBe('0'.repeat(32));
  });

  it('rejects traversal and encoded slashes', async () => {
    const { fake, deps } = setup();
    for (const path of [
      ['v1', 'conversations', '..', 'files'],
      ['v1', 'conversations', CNV + '/../..', 'events'],
      ['v1', 'conversations', CNV, 'events%2F..'],
      ['v1', '..%2Ffiles'],
    ]) {
      const response = await proxyToBackend(new Request('http://localhost/x'), path, deps);
      expect(response.status).toBe(404);
    }
    expect(fake).not.toHaveBeenCalled();
  });

  it('returns 503 UPSTREAM_UNAVAILABLE when upstream fails', async () => {
    const { deps } = setup(async () => {
      throw new TypeError('fetch failed');
    });
    const response = await proxyToBackend(
      new Request('http://localhost/x', { method: 'POST', body: '{}' }),
      ['v1', 'conversations'],
      deps,
    );
    expect(response.status).toBe(503);
    expect(response.headers.get('retry-after')).toBe('1');
    expect(response.headers.get('content-type')).toBe('application/problem+json');
    expect((await response.json()).code).toBe('UPSTREAM_UNAVAILABLE');
  });
});
