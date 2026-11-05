// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as adminGet } from '@/app/api/admin/[...path]/route';
import { GET as sessionGet } from '@/app/api/session/route';
import { POST as logout } from '@/app/auth/logout/route';
import { writeSession, type UserSession } from '@/server/auth/session';
import { FakeServers, ISSUER, PUBLIC_URL, jar, setupAuthEnv, teardownAuthEnv } from './helpers';

vi.mock('next/headers', async () => (await import('./helpers')).headersMock());

let servers: FakeServers;
beforeEach(async () => {
  setupAuthEnv();
  servers = await new FakeServers().init();
});
afterEach(teardownAuthEnv);

const user = (roles: string[]): UserSession => ({
  accessToken: 'access-tok',
  refreshToken: 'refresh-tok',
  accessExpiresAt: Date.now() + 600_000,
  refreshExpiresAt: Date.now() + 1_800_000,
  sub: 'user-1',
  name: 'Awa Diallo',
  roles,
  idToken: 'id-tok-1',
});

const adminRequest = () =>
  adminGet(new Request(`${PUBLIC_URL}/api/admin/v1/admin/me`), { params: Promise.resolve({ path: ['v1', 'admin', 'me'] }) });

describe('/api/admin', () => {
  it('answers 401 UNAUTHORIZED problem+json without a session', async () => {
    const response = await adminRequest();
    expect(response.status).toBe(401);
    expect(response.headers.get('content-type')).toBe('application/problem+json');
    expect(await response.json()).toMatchObject({ code: 'UNAUTHORIZED', status: 401 });
    expect(servers.callsTo('/v1/admin')).toHaveLength(0);
  });

  it('answers 403 FORBIDDEN without the official role', async () => {
    await writeSession({ user: user(['citizen']) });
    const response = await adminRequest();
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: 'FORBIDDEN', status: 403 });
    expect(servers.callsTo('/v1/admin')).toHaveLength(0);
  });

  it('proxies with the user token for an official', async () => {
    await writeSession({ user: user(['official']) });
    const response = await adminRequest();
    expect(response.status).toBe(599); // the fake Backend has no admin route: the call did reach it
    const [call] = servers.callsTo('/v1/admin/me');
    expect(call.headers.get('authorization')).toBe('Bearer access-tok');
  });
});

describe('GET /api/session', () => {
  it('returns null without a user', async () => {
    expect(await (await sessionGet()).json()).toEqual({ user: null, signIn: 'oidc' });
  });

  it('returns name and roles, never a token', async () => {
    await writeSession({ user: user(['official']) });
    const text = await (await sessionGet()).text();
    expect(JSON.parse(text)).toEqual({ user: { name: 'Awa Diallo', roles: ['official'] }, signIn: 'oidc' });
    expect(text).not.toContain('tok');
    expect(text).not.toContain('id-tok');
  });

  it('returns null once the refresh token has expired', async () => {
    await writeSession({ user: { ...user(['official']), refreshExpiresAt: Date.now() - 1 } });
    expect(await (await sessionGet()).json()).toEqual({ user: null, signIn: 'oidc' });
  });

  it('announces the NPI sign-in when the option is on', async () => {
    vi.stubEnv('NPI_SIMULATED_LOGIN', 'on');
    expect(await (await sessionGet()).json()).toEqual({ user: null, signIn: 'npi' });
  });
});

describe('POST /auth/logout', () => {
  const post = (origin?: string) =>
    logout(new Request(`${PUBLIC_URL}/auth/logout`, { method: 'POST', headers: origin ? { origin } : {} }));

  it('refuses a cross-origin or origin-less POST and keeps the session', async () => {
    await writeSession({ user: user(['official']) });
    for (const origin of ['https://evil.example', 'http://localhost:3000', undefined]) {
      expect((await post(origin)).status).toBe(403);
    }
    expect(jar.has('ad_session')).toBe(true);
  });

  it('clears the session cookies and 303s to the end-session URL', async () => {
    await writeSession({ user: user(['official']) });
    jar.set('ad_session.5', 'stale');
    const response = await post(PUBLIC_URL);
    expect(response.status).toBe(303);
    const location = new URL(response.headers.get('location')!);
    expect(location.origin + location.pathname).toBe(`${ISSUER}/protocol/openid-connect/logout`);
    expect(location.searchParams.get('client_id')).toBe('interface');
    expect(location.searchParams.get('post_logout_redirect_uri')).toBe(`${PUBLIC_URL}/`);
    expect([...jar.keys()].filter((name) => name.startsWith('ad_session'))).toEqual([]);
  });

  it('sends id_token_hint when logged in', async () => {
    await writeSession({ user: user(['official']) });
    const location = new URL((await post(PUBLIC_URL)).headers.get('location')!);
    expect(location.searchParams.get('id_token_hint')).toBe('id-tok-1');
  });

  it('does not go through Keycloak for an NPI session', async () => {
    await writeSession({ user: { ...user(['citizen']), refreshToken: '', provider: 'npi' } });
    const response = await post(PUBLIC_URL);
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(`${PUBLIC_URL}/`);
    expect(servers.calls).toHaveLength(0);
    expect(jar.size).toBe(0);
  });

  it('omits id_token_hint without a session', async () => {
    const response = await post(PUBLIC_URL);
    const location = new URL(response.headers.get('location')!);
    expect(location.searchParams.has('id_token_hint')).toBe(false);
    expect(location.searchParams.get('client_id')).toBe('interface');
  });

  it('still clears the session and returns home when Keycloak is unreachable', async () => {
    await writeSession({ user: user(['official']) });
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('fetch failed');
    });
    const response = await post(PUBLIC_URL);
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(`${PUBLIC_URL}/`);
    expect(jar.size).toBe(0);
  });
});
