// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEMO_SESSION_IDENTITIES, getActiveIdentity, getSession, switchIdentity } from '@/server/session';

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'development');
  vi.stubEnv('MOCK_ADMIN_TOKEN', 'mock-admin');
  vi.stubEnv('BACKEND_URL', 'http://127.0.0.1:4010');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('getSession', () => {
  it('defaults to the first identity', () => {
    const session = getSession(undefined);
    expect(session.activeIdentityId).toBe('idt_platform');
    expect(session.displayName).toBe('Agent de démonstration');
    expect(session.identities).toEqual(DEMO_SESSION_IDENTITIES);
  });

  it('selects the identity named by the cookie', () => {
    expect(getSession('idt_mairie_read').activeIdentityId).toBe('idt_mairie_read');
    expect(getActiveIdentity('idt_demo_write').administrationId).toBe('demo-administration');
  });

  it('falls back on an unknown cookie', () => {
    expect(getSession('evil').activeIdentityId).toBe('idt_platform');
  });

  it('throws in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(() => getSession(undefined)).toThrow('Session OIDC administrateur non branchée');
  });

  it('throws for a mock token with a non-loopback backend', () => {
    vi.stubEnv('BACKEND_URL', 'https://backend.example.org');
    expect(() => getSession(undefined)).toThrow();
  });
});

const post = (body: BodyInit, { url = 'http://localhost:3000/api/session/identity', origin = new URL(url).origin as string | null } = {}) =>
  new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) },
    body,
  });
const switchTo = (identityId: unknown) => post(JSON.stringify({ identityId }));

describe('switchIdentity', () => {
  it('sets a hardened cookie and returns the session without any token', async () => {
    const response = await switchIdentity(switchTo('idt_mairie_read'));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const cookie = response.headers.get('set-cookie')!;
    expect(cookie).toContain('admin_identity=idt_mairie_read');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/');
    expect(cookie).not.toContain('Secure');
    const text = await response.text();
    expect(JSON.parse(text).activeIdentityId).toBe('idt_mairie_read');
    expect(text).not.toContain('token');
    expect(text).not.toContain('mock-');
  });

  it('adds Secure on https', async () => {
    const url = 'https://console.example.org/api/session/identity';
    const response = await switchIdentity(post(JSON.stringify({ identityId: 'idt_platform' }), { url }));
    expect(response.headers.get('set-cookie')).toContain('Secure');
  });

  it('returns 400 for unknown id, bad JSON, wrong type and oversized body', async () => {
    for (const request of [
      switchTo('nope'),
      switchTo(42),
      post('{not json'),
      post('null'),
      post(JSON.stringify({ identityId: 'idt_platform', pad: 'x'.repeat(2048) })),
    ]) {
      const response = await switchIdentity(request);
      expect(response.status).toBe(400);
      expect(response.headers.get('set-cookie')).toBeNull();
      expect((await response.json()).code).toBe('INVALID_REQUEST');
    }
  });

  it('returns 403 for a bad or missing Origin', async () => {
    for (const origin of ['http://evil.example.org', null]) {
      const response = await switchIdentity(post(JSON.stringify({ identityId: 'idt_platform' }), { origin }));
      expect(response.status).toBe(403);
      expect(response.headers.get('set-cookie')).toBeNull();
      expect((await response.json()).code).toBe('FORBIDDEN');
    }
  });

  it('returns 503 in production without leaking the cause', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubEnv('NODE_ENV', 'production');
    const response = await switchIdentity(switchTo('idt_platform'));
    expect(response.status).toBe(503);
    const text = await response.text();
    expect(JSON.parse(text).code).toBe('UPSTREAM_UNAVAILABLE');
    expect(text).not.toContain('OIDC');
  });
});
