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

describe('proxyToBackend JSON body limit', () => {
  it('rejects a JSON body over 64 Kio with 400 INVALID_REQUEST', async () => {
    const { fake, deps } = setup();
    const request = new Request('http://localhost/api/backend/v1/conversations', {
      method: 'POST',
      headers: { 'content-type': 'application/json', traceparent: TRACE },
      body: JSON.stringify({ padding: 'x'.repeat(70 * 1024) }),
    });
    const response = await proxyToBackend(request, ['v1', 'conversations'], deps);
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe('INVALID_REQUEST');
    expect(fake).not.toHaveBeenCalled();
  });
});

describe('proxyToBackend POST /v1/files', () => {
  const upload = (body: BodyInit, headers: Record<string, string> = {}) =>
    new Request('http://localhost/api/backend/v1/files', {
      method: 'POST',
      headers: {
        'content-type': 'application/octet-stream',
        'x-file-mime-type': 'application/pdf',
        'idempotency-key': 'abcdefgh',
        traceparent: TRACE,
        ...headers,
      },
      body,
    });

  it('returns 413 from content-length without calling fetch', async () => {
    const { fake, deps } = setup();
    const response = await proxyToBackend(upload('x', { 'content-length': '10485761' }), ['v1', 'files'], deps);
    expect(response.status).toBe(413);
    expect(response.headers.get('content-type')).toBe('application/problem+json');
    expect(await response.json()).toMatchObject({ code: 'FILE_TOO_LARGE', detail: '10 Mio maximum' });
    expect(fake).not.toHaveBeenCalled();
  });

  it('returns 413 from the actual body size', async () => {
    const { fake, deps } = setup();
    const response = await proxyToBackend(upload(new Uint8Array(10485761)), ['v1', 'files'], deps);
    expect(response.status).toBe(413);
    expect(fake).not.toHaveBeenCalled();
  });

  it('stops reading a streamed body without content-length once over the limit', async () => {
    const { fake, deps } = setup();
    const chunk = new Uint8Array(1024 * 1024);
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(chunk); // never closes: an endless upload
      },
    });
    const request = new Request('http://localhost/api/backend/v1/files', {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream', 'x-file-mime-type': 'application/pdf', traceparent: TRACE },
      body: stream,
      duplex: 'half',
    } as RequestInit);
    expect(request.headers.get('content-length')).toBeNull();
    const response = await proxyToBackend(request, ['v1', 'files'], deps);
    expect(response.status).toBe(413);
    expect(pulled).toBeLessThanOrEqual(12);
    expect(fake).not.toHaveBeenCalled();
  });

  it('forwards body bytes and x-file-mime-type', async () => {
    const { fake, deps } = setup();
    const bytes = new TextEncoder().encode('%PDF-1.4');
    const response = await proxyToBackend(upload(bytes), ['v1', 'files'], deps);
    expect(response.status).toBe(202);
    const [, init] = fake.mock.calls[0] as unknown as [URL, RequestInit];
    expect(new Uint8Array(init.body as ArrayBuffer)).toEqual(bytes);
    const headers = init.headers as Headers;
    expect(headers.get('x-file-mime-type')).toBe('application/pdf');
    expect(headers.get('content-type')).toBe('application/octet-stream');
  });
});
