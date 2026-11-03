// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_COOKIE_VALUE, clearSession, readSession, seal, writeSession, type Session } from '@/server/auth/session';
import { headersMock, jar, setCalls, setupAuthEnv, teardownAuthEnv } from './helpers';

vi.mock('next/headers', async () => (await import('./helpers')).headersMock());

beforeEach(() => setupAuthEnv());
afterEach(teardownAuthEnv);

const small: Session = {
  guest: { token: 'g.t.k', expiresAt: '2030-01-01T00:00:00.000Z' },
};
const bigUser = (size: number): Session => ({
  user: {
    accessToken: 'a'.repeat(size),
    refreshToken: 'r'.repeat(size),
    accessExpiresAt: 1,
    refreshExpiresAt: 2,
    sub: 'u1',
    name: 'Awa',
    roles: ['citizen'],
  },
});

describe('session cookie', () => {
  it('round-trips through one HttpOnly SameSite=Lax cookie without Secure on http', async () => {
    await writeSession(small);
    expect([...jar.keys()]).toEqual(['ad_session']);
    expect(setCalls[0].options).toMatchObject({ httpOnly: true, sameSite: 'lax', path: '/', secure: false });
    expect(await readSession()).toEqual(small);
    expect(jar.get('ad_session')).not.toContain('g.t.k');
  });

  it('sets Secure only when PUBLIC_URL is https', async () => {
    teardownAuthEnv();
    setupAuthEnv({ PUBLIC_URL: 'https://assistant.example.org' });
    await writeSession(small);
    expect(setCalls[0].options.secure).toBe(true);
  });

  it('treats a tampered or foreign cookie as an empty session', async () => {
    await writeSession(small);
    const value = jar.get('ad_session')!;
    jar.set('ad_session', value.slice(0, -4) + (value.endsWith('AAAA') ? 'BBBB' : 'AAAA'));
    expect(await readSession()).toEqual({});
    jar.set('ad_session', 'not-a-jwe');
    expect(await readSession()).toEqual({});
    jar.set('ad_session', await seal({ user: { accessToken: 1 } }));
    expect(await readSession()).toEqual({});
  });

  it('splits an oversized value across numbered cookies and reassembles it', async () => {
    const session = bigUser(2400);
    await writeSession(session);
    const names = [...jar.keys()].sort();
    expect(names).toEqual(['ad_session.0', 'ad_session.1']);
    for (const value of jar.values()) expect(value.length).toBeLessThanOrEqual(MAX_COOKIE_VALUE);
    expect(await readSession()).toEqual(session);
  });

  it('removes stale chunks and the single cookie when the layout changes', async () => {
    await writeSession(bigUser(5000));
    expect(jar.size).toBeGreaterThanOrEqual(3);
    await writeSession(small);
    expect([...jar.keys()]).toEqual(['ad_session']);
    await writeSession(bigUser(5000));
    expect(jar.has('ad_session')).toBe(false);
    await writeSession({});
    expect(jar.size).toBe(0);
  });

  it('clearSession deletes every session cookie but leaves others', async () => {
    jar.set('theme', 'dark');
    await writeSession(bigUser(5000));
    await clearSession();
    expect([...jar.keys()]).toEqual(['theme']);
  });
});
