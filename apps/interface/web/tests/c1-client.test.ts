import { describe, expect, it, vi } from 'vitest';
import { C1Client, caseDocumentHref } from '@/lib/c1-client';

describe('C1Client.uploadFile', () => {
  it('sends the Blob as-is with the 4 headers', async () => {
    const fake = vi.fn(async () => new Response('{"id":"fil_X"}', { status: 201, headers: { 'content-type': 'application/json' } }));
    const client = new C1Client(fake as unknown as typeof fetch);
    const blob = new Blob(['%PDF-1.4']);
    const file = await client.uploadFile(blob, 'application/pdf', 'key-123');
    expect(file).toEqual({ id: 'fil_X' });
    const [url, init] = fake.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/backend/v1/files');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(blob);
    const headers = init.headers as Record<string, string>;
    expect(headers['content-type']).toBe('application/octet-stream');
    expect(headers['x-file-mime-type']).toBe('application/pdf');
    expect(headers['idempotency-key']).toBe('key-123');
    expect(headers.traceparent).toMatch(/^00-[a-f0-9]{32}-[a-f0-9]{16}-01$/);
  });
});

describe('C1Client cases', () => {
  const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

  it('lists cases with the opaque cursor and gets one case', async () => {
    const fake = vi.fn(async () => ok({ items: [], nextCursor: null }));
    const client = new C1Client(fake as unknown as typeof fetch);
    await client.listCases();
    await client.listCases('a b');
    await client.getCase('cas_1');
    expect(fake.mock.calls.map((call) => (call as unknown as [string])[0])).toEqual([
      '/api/backend/v1/cases',
      '/api/backend/v1/cases?cursor=a%20b',
      '/api/backend/v1/cases/cas_1',
    ]);
  });

  it('builds the document download path under the proxy', () => {
    expect(caseDocumentHref('cas_1', 'doc_2')).toBe('/api/backend/v1/cases/cas_1/documents/doc_2');
  });

  it('creates a conversation with only the locale', async () => {
    const fake = vi.fn(async () => ok({ id: 'cnv_1' }));
    await new C1Client(fake as unknown as typeof fetch).createConversation({ locale: 'fr' }, 'k');
    const [, init] = fake.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ locale: 'fr' });
  });
});
