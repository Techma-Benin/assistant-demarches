// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as callback } from '@/app/auth/callback/route';
import { GET as login } from '@/app/auth/login/route';
import { loginHref } from '@/lib/auth-links';
import { readSession, seal } from '@/server/auth/session';
import { BACKEND_URL, CNV, FakeServers, ISSUER, PUBLIC_URL, jar, setupAuthEnv, teardownAuthEnv } from './helpers';

vi.mock('next/headers', async () => (await import('./helpers')).headersMock());

let servers: FakeServers;
beforeEach(async () => {
  setupAuthEnv();
  servers = await new FakeServers().init();
});
afterEach(teardownAuthEnv);

const doLogin = (query: string) => login(new Request(`${PUBLIC_URL}/auth/login${query}`));

async function startLogin(query = '?returnTo=/dossiers') {
  const response = await doLogin(query);
  const url = new URL(response.headers.get('location')!);
  servers.nonce = url.searchParams.get('nonce')!;
  return { response, url, state: url.searchParams.get('state')! };
}

const doCallback = (search: string) => callback(new Request(`${PUBLIC_URL}/auth/callback${search}`));

describe('GET /auth/login', () => {
  it('moves a login started on another host (localhost) to the PUBLIC_URL host first', async () => {
    const response = await login(
      new Request('http://localhost:3000/auth/login?returnTo=%2Fadmin', { headers: { host: 'localhost:3000' } }),
    );
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(`${PUBLIC_URL}/auth/login?returnTo=%2Fadmin`);
  });

  it('redirects to Keycloak with PKCE S256, state and nonce, and stores ad_auth', async () => {
    const { response, url } = await startLogin('?returnTo=/dossiers&conversationId=' + CNV);
    expect(response.status).toBe(302);
    expect(url.origin + url.pathname).toBe(`${ISSUER}/protocol/openid-connect/auth`);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBeTruthy();
    expect(url.searchParams.get('state')).toBeTruthy();
    expect(url.searchParams.get('nonce')).toBeTruthy();
    expect(url.searchParams.get('scope')).toBe('openid profile');
    expect(url.searchParams.get('client_id')).toBe('interface');
    expect(url.searchParams.get('redirect_uri')).toBe(`${PUBLIC_URL}/auth/callback`);
    expect(jar.get('ad_auth')).toBeTruthy();
    expect(jar.get('ad_auth')).not.toContain(url.searchParams.get('state'));
  });

  it.each(['https://evil.example/x', '//evil.example', '/\\evil.example', 'dossiers', '/a\\b'])(
    'ignores unsafe returnTo %s',
    async (returnTo) => {
      const { state } = await startLogin(`?returnTo=${encodeURIComponent(returnTo)}`);
      const response = await doCallback(`?code=c&state=${state}`);
      expect(new URL(response.headers.get('location')!).pathname).toBe('/');
    },
  );

  it('ignores a malformed conversationId', async () => {
    const { state } = await startLogin('?returnTo=/x&conversationId=cnv_nope');
    await doCallback(`?code=c&state=${state}`);
    expect(servers.callsTo('/attach')).toHaveLength(0);
  });

  it('builds the chat link', () => {
    expect(loginHref('/', CNV)).toBe(`/auth/login?returnTo=%2F&conversationId=${CNV}`);
    expect(loginHref('/admin')).toBe('/auth/login?returnTo=%2Fadmin');
  });
});

describe('GET /auth/callback', () => {
  it('redirects to / with auth=failed on a state mismatch, and drops ad_auth', async () => {
    await startLogin();
    const response = await doCallback('?code=c&state=wrong');
    const location = new URL(response.headers.get('location')!);
    expect(location.pathname).toBe('/');
    expect(location.searchParams.get('auth')).toBe('failed');
    expect(jar.has('ad_auth')).toBe(false);
    expect((await readSession()).user).toBeUndefined();
    expect(servers.callsTo('/token')).toHaveLength(0);
  });

  it('fails without a login transaction', async () => {
    const response = await doCallback('?code=c&state=s');
    expect(new URL(response.headers.get('location')!).searchParams.get('auth')).toBe('failed');
  });

  it('never echoes provider error text', async () => {
    const { state } = await startLogin();
    const response = await doCallback(`?error=access_denied&error_description=${encodeURIComponent('<script>x</script>')}&state=${state}`);
    const location = response.headers.get('location')!;
    expect(location).toBe(`${PUBLIC_URL}/?auth=failed`);
    expect(location).not.toContain('script');
  });

  it('fails when the id_token nonce does not match', async () => {
    const { state } = await startLogin();
    servers.nonce = 'another-nonce';
    const response = await doCallback(`?code=c&state=${state}`);
    expect(new URL(response.headers.get('location')!).searchParams.get('auth')).toBe('failed');
  });

  it('stores the user (with its id_token) and redirects to returnTo', async () => {
    servers.roles = ['official'];
    const { state } = await startLogin('?returnTo=/dossiers%3Fa%3D1');
    const response = await doCallback(`?code=c&state=${state}`);
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(`${PUBLIC_URL}/dossiers?a=1`);
    expect(jar.has('ad_auth')).toBe(false);
    const { user } = await readSession();
    expect(user).toMatchObject({ sub: 'user-1', name: 'Awa Diallo', roles: ['official'], refreshToken: 'refresh-1' });
    expect(user!.accessExpiresAt).toBeGreaterThan(Date.now());
    expect(user!.idToken).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/);
  });

  async function loginWithGuest(attachStatus: number) {
    servers.attachStatus = attachStatus;
    jar.set('ad_session', await seal({ guest: { token: 'guest-1', expiresAt: new Date(Date.now() + 3600_000).toISOString() } }));
    const { state } = await startLogin(`?returnTo=/&conversationId=${CNV}`);
    return doCallback(`?code=c&state=${state}`);
  }

  it('attaches the guest conversations with the user Bearer and drops the guest token on 200', async () => {
    const response = await loginWithGuest(200);
    const [call] = servers.callsTo('/attach');
    expect(call.url).toBe(`${BACKEND_URL}/v1/conversations/${CNV}/attach`);
    expect(JSON.parse(call.body)).toEqual({ guestToken: 'guest-1' });
    const { user, guest } = await readSession();
    expect(call.headers.get('authorization')).toBe(`Bearer ${user!.accessToken}`);
    expect(guest).toBeUndefined();
    expect(response.headers.get('location')).toBe(`${PUBLIC_URL}/`);
  });

  it('keeps the guest token and appends attach=failed when attach fails', async () => {
    const response = await loginWithGuest(404);
    const { user, guest } = await readSession();
    expect(user).toBeDefined();
    expect(guest?.token).toBe('guest-1');
    expect(response.headers.get('location')).toBe(`${PUBLIC_URL}/?attach=failed`);
  });

  it('does not attach an expired guest token', async () => {
    jar.set('ad_session', await seal({ guest: { token: 'old', expiresAt: new Date(Date.now() - 1000).toISOString() } }));
    const { state } = await startLogin(`?returnTo=/&conversationId=${CNV}`);
    const response = await doCallback(`?code=c&state=${state}`);
    expect(servers.callsTo('/attach')).toHaveLength(0);
    expect(response.headers.get('location')).toBe(`${PUBLIC_URL}/`);
  });
});
