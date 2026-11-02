import { describe, expect, it, vi } from 'vitest';
import { C1Client } from '@/lib/c1-client';

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
