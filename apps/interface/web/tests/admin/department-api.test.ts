import { afterEach, describe, expect, it, vi } from 'vitest';
import { C3Error } from '@/lib/operator/c3-client';
import { DepartmentClient } from '@/lib/admin/department-api';
import { json, problem } from './helpers/c3-fetch';

afterEach(() => vi.unstubAllGlobals());

const TRACEPARENT = /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/;

function client(response: () => Response) {
  const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => response());
  return { api: new DepartmentClient(fetchMock as unknown as typeof fetch), fetchMock };
}

describe('DepartmentClient', () => {
  it('builds the work-items query and skips empty parameters', async () => {
    const { api, fetchMock } = client(() => json({ items: [], nextCursor: null }));
    await api.listWorkItems({ departmentId: 'justice', status: 'pending', cursor: 'c1', limit: 20 });
    await api.listWorkItems({ departmentId: null, status: 'completed' });
    expect(fetchMock.mock.calls[0]![0]).toBe(
      '/api/admin/v1/admin/work-items?departmentId=justice&cursor=c1&limit=20&status=pending',
    );
    expect(fetchMock.mock.calls[1]![0]).toBe('/api/admin/v1/admin/work-items?status=completed');
  });

  it('sends a traceparent on GET and none of the POST-only headers', async () => {
    const { api, fetchMock } = client(() => json({ items: [], nextCursor: null }));
    await api.listActivity({ departmentId: 'justice' });
    const init = fetchMock.mock.calls[0]![1]!;
    const headers = init.headers as Record<string, string>;
    expect(init.method).toBe('GET');
    expect(headers.traceparent).toMatch(TRACEPARENT);
    expect(headers['idempotency-key']).toBeUndefined();
  });

  it('POSTs an action with Idempotency-Key, traceparent and a JSON body', async () => {
    const { api, fetchMock } = client(() => json({ id: 'req_1' }));
    await api.act('req_1', { action: 'claim', revision: 4 }, 'key-12345678');
    const [url, init] = fetchMock.mock.calls[0]!;
    const headers = init!.headers as Record<string, string>;
    expect(url).toBe('/api/admin/v1/admin/work-items/req_1/actions');
    expect(init!.method).toBe('POST');
    expect(headers['idempotency-key']).toBe('key-12345678');
    expect(headers.traceparent).toMatch(TRACEPARENT);
    expect(headers['content-type']).toBe('application/json');
    expect(JSON.parse(String(init!.body))).toEqual({ action: 'claim', revision: 4 });
  });

  it('POSTs the resolution of an unanswered question', async () => {
    const { api, fetchMock } = client(() => json({ id: 'una_1', status: 'resolved' }));
    await api.resolveUnanswered('una_1', 'resolve-12345678');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/admin/v1/admin/unanswered/una_1/resolve');
    expect((init!.headers as Record<string, string>)['idempotency-key']).toBe('resolve-12345678');
  });

  it('parses a problem+json error', async () => {
    const { api } = client(() => problem(409, 'INVALID_TRANSITION', 'Révision périmée'));
    const error = await api.getWorkItem('req_1').catch((e) => e);
    expect(error).toBeInstanceOf(C3Error);
    expect(error.status).toBe(409);
    expect(error.problem?.code).toBe('INVALID_TRANSITION');
  });

  it('keeps the status when the error body is not JSON', async () => {
    const { api } = client(() => new Response('boom', { status: 502 }));
    const error = await api.getDashboard({ departmentId: 'justice' }).catch((e) => e);
    expect(error).toBeInstanceOf(C3Error);
    expect(error.status).toBe(502);
    expect(error.problem).toBeUndefined();
  });

  it('builds the private document download URL', () => {
    expect(new DepartmentClient().documentUrl('req_1', 'fil_1')).toBe(
      '/api/admin/v1/admin/work-items/req_1/documents/fil_1',
    );
  });
});
