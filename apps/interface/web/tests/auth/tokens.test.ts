// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getBackendToken, getUserAccessToken, requireRole } from '@/server/auth/tokens';
import { readSession, writeSession, type UserSession } from '@/server/auth/session';
import { FakeServers, setupAuthEnv, teardownAuthEnv } from './helpers';

vi.mock('next/headers', async () => (await import('./helpers')).headersMock());

let servers: FakeServers;
beforeEach(async () => {
  setupAuthEnv();
  servers = await new FakeServers().init();
});
afterEach(teardownAuthEnv);

const user = (overrides: Partial<UserSession> = {}): UserSession => ({
  accessToken: 'access-old',
  refreshToken: 'refresh-old',
  accessExpiresAt: Date.now() + 600_000,
  refreshExpiresAt: Date.now() + 1_800_000,
  sub: 'user-1',
  name: 'Awa',
  roles: ['citizen'],
  ...overrides,
});

const refreshCalls = () => servers.callsTo('/token');

describe('getUserAccessToken', () => {
  it('returns null without a session', async () => {
    expect(await getUserAccessToken()).toBeNull();
  });

  it('returns the stored token while it is valid for more than 30 s', async () => {
    await writeSession({ user: user() });
    expect(await getUserAccessToken()).toBe('access-old');
    expect(refreshCalls()).toHaveLength(0);
  });

  it('refreshes when the token expires within 30 s and rotates the refresh token', async () => {
    servers.roles = ['official'];
    await writeSession({ user: user({ accessExpiresAt: Date.now() + 20_000 }) });
    const token = await getUserAccessToken();
    expect(token).not.toBe('access-old');
    const [call] = refreshCalls();
    expect(new URLSearchParams(call.body).get('refresh_token')).toBe('refresh-old');
    expect(new URLSearchParams(call.body).get('grant_type')).toBe('refresh_token');
    const stored = (await readSession()).user!;
    expect(stored.accessToken).toBe(token);
    expect(stored.refreshToken).toBe('refresh-1');
    expect(stored.roles).toEqual(['official']);
    expect(stored.name).toBe('Awa');
    expect(stored.accessExpiresAt).toBeGreaterThan(Date.now() + 800_000);
  });

  it('keeps the previous id_token when the refresh returns none', async () => {
    await writeSession({ user: user({ accessExpiresAt: Date.now() + 20_000, idToken: 'id-old' }) });
    await getUserAccessToken();
    expect((await readSession()).user!.idToken).toBe('id-old');
  });

  it('replaces the id_token when the refresh returns one', async () => {
    servers.refreshReturnsIdToken = true;
    await writeSession({ user: user({ accessExpiresAt: Date.now() + 20_000, idToken: 'id-old' }) });
    await getUserAccessToken();
    const { idToken } = (await readSession()).user!;
    expect(idToken).toBeTruthy();
    expect(idToken).not.toBe('id-old');
  });

  it('shares one refresh between concurrent requests', async () => {
    await writeSession({ user: user({ accessExpiresAt: Date.now() + 1000 }) });
    const [a, b] = await Promise.all([getUserAccessToken(), getUserAccessToken()]);
    expect(a).toBe(b);
    expect(refreshCalls()).toHaveLength(1);
  });

  it('logs out (clears user, keeps guest) when the refresh fails', async () => {
    servers.refreshFails = true;
    const guest = { token: 'g', expiresAt: new Date(Date.now() + 3600_000).toISOString() };
    await writeSession({ guest, user: user({ accessExpiresAt: Date.now() - 1 }) });
    expect(await getUserAccessToken()).toBeNull();
    expect(await readSession()).toEqual({ guest });
  });

  it('logs out without calling Keycloak when the refresh token has expired', async () => {
    await writeSession({ user: user({ accessExpiresAt: Date.now() - 1, refreshExpiresAt: Date.now() - 1 }) });
    expect(await getUserAccessToken()).toBeNull();
    expect(refreshCalls()).toHaveLength(0);
    expect(await readSession()).toEqual({});
  });
});

describe('NPI session', () => {
  const npi = (overrides: Partial<UserSession> = {}) =>
    user({ refreshToken: '', provider: 'npi', accessToken: 'npi-tok', roles: ['citizen'], ...overrides });

  it('is used while valid', async () => {
    await writeSession({ user: npi({ accessExpiresAt: Date.now() + 3600_000, refreshExpiresAt: Date.now() + 3600_000 }) });
    expect(await getUserAccessToken()).toBe('npi-tok');
  });

  it('is removed without any refresh close to its expiry, keeping the guest', async () => {
    const guest = { token: 'g', expiresAt: new Date(Date.now() + 3600_000).toISOString() };
    await writeSession({ guest, user: npi({ accessExpiresAt: Date.now() + 10_000, refreshExpiresAt: Date.now() + 10_000 }) });
    expect(await getUserAccessToken()).toBeNull();
    expect(refreshCalls()).toHaveLength(0);
    expect(servers.calls).toHaveLength(0);
    expect(await readSession()).toEqual({ guest });
  });
});

describe('getBackendToken', () => {
  it('prefers the user token', async () => {
    await writeSession({ user: user() });
    expect(await getBackendToken()).toBe('access-old');
    expect(servers.callsTo('guest-sessions')).toHaveLength(0);
  });

  it('creates a guest session when none exists and reuses it afterwards', async () => {
    const first = await getBackendToken();
    expect(first).toMatch(/^guest-token-/);
    expect((await readSession()).guest?.token).toBe(first);
    expect(await getBackendToken()).toBe(first);
    expect(servers.callsTo('guest-sessions')).toHaveLength(1);
    expect(servers.callsTo('guest-sessions')[0].headers.get('authorization')).toBeNull();
  });

  it('creates a new guest session when the stored one expires within 5 minutes', async () => {
    await writeSession({ guest: { token: 'soon-gone', expiresAt: new Date(Date.now() + 4 * 60_000).toISOString() } });
    const token = await getBackendToken();
    expect(token).not.toBe('soon-gone');
    expect(servers.callsTo('guest-sessions')).toHaveLength(1);
  });

  it('keeps a guest session that is still valid for more than 5 minutes', async () => {
    await writeSession({ guest: { token: 'fine', expiresAt: new Date(Date.now() + 10 * 60_000).toISOString() } });
    expect(await getBackendToken()).toBe('fine');
    expect(servers.callsTo('guest-sessions')).toHaveLength(0);
  });

  it('throws when the Backend cannot create a guest session', async () => {
    servers.guestFails = true;
    await expect(getBackendToken()).rejects.toThrow('guest-sessions');
  });
});

describe('requireRole', () => {
  it('fails as unauthenticated without a user (a guest is not enough)', async () => {
    await writeSession({ guest: { token: 'g', expiresAt: new Date(Date.now() + 3600_000).toISOString() } });
    expect(await requireRole('official')).toEqual({ ok: false, reason: 'unauthenticated' });
  });

  it('fails as forbidden without the role', async () => {
    await writeSession({ user: user({ roles: ['citizen'] }) });
    expect(await requireRole('official')).toEqual({ ok: false, reason: 'forbidden' });
  });

  it('returns the token when the role is held', async () => {
    await writeSession({ user: user({ roles: ['citizen', 'official'] }) });
    expect(await requireRole('official')).toMatchObject({ ok: true, token: 'access-old' });
  });
});
