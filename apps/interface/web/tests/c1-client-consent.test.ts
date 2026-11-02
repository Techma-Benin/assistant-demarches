import { describe, expect, it, vi } from 'vitest';
import { C1Client } from '@/lib/c1-client';

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 201, headers: { 'content-type': 'application/json' } });

describe('C1Client consent calls', () => {
  it('posts the challenge body and Idempotency-Key', async () => {
    const fake = vi.fn(async () => json({ id: 'chl_1' }));
    await new C1Client(fake as unknown as typeof fetch).createMandateChallenge('cnv_1', { procedureId: 'p', scopes: ['requests:write'] }, 'k1');
    const [url, init] = fake.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/backend/v1/conversations/cnv_1/mandate-challenges');
    expect(JSON.parse(init.body as string)).toEqual({ procedureId: 'p', scopes: ['requests:write'] });
    const headers = init.headers as Record<string, string>;
    expect(headers['idempotency-key']).toBe('k1');
    expect(headers.traceparent).toMatch(/^00-/);
  });

  it('posts the consent and the revoke without body', async () => {
    const fake = vi.fn(async () => json({ id: 'mdt_1' }));
    const client = new C1Client(fake as unknown as typeof fetch);
    await client.createMandate('cnv_1', { challengeId: 'chl_1', accepted: true }, 'consent-chl_1');
    await client.revokeMandate('cnv_1', 'mdt_1', 'r1');
    const [url1, init1] = fake.mock.calls[0] as unknown as [string, RequestInit];
    expect(url1).toBe('/api/backend/v1/conversations/cnv_1/mandates');
    expect(JSON.parse(init1.body as string)).toEqual({ challengeId: 'chl_1', accepted: true });
    expect((init1.headers as Record<string, string>)['idempotency-key']).toBe('consent-chl_1');
    const [url2, init2] = fake.mock.calls[1] as unknown as [string, RequestInit];
    expect(url2).toBe('/api/backend/v1/conversations/cnv_1/mandates/mdt_1/revoke');
    expect(init2.body).toBeUndefined();
    expect((init2.headers as Record<string, string>)['idempotency-key']).toBe('r1');
  });
});
