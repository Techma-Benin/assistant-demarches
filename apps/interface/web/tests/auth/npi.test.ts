// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as start } from '@/app/auth/npi/route';
import { POST as verify } from '@/app/auth/npi/verify/route';
import { readSession, writeSession } from '@/server/auth/session';
import { CNV, FakeServers, PUBLIC_URL, jar, setupAuthEnv, teardownAuthEnv } from './helpers';

vi.mock('next/headers', async () => (await import('./helpers')).headersMock());

let servers: FakeServers;
beforeEach(async () => {
  setupAuthEnv();
  vi.stubEnv('NPI_SIMULATED_LOGIN', 'on');
  servers = await new FakeServers().init();
});
afterEach(teardownAuthEnv);

const post = (handler: typeof start, body: unknown, origin: string | null = PUBLIC_URL) =>
  handler(
    new Request(`${PUBLIC_URL}/auth/npi`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  );

const guest = () => ({ token: 'guest-tok', expiresAt: new Date(Date.now() + 3600_000).toISOString() });
const challenge = (offset = 120_000) => ({ token: 'challenge-secret', expiresAt: new Date(Date.now() + offset).toISOString() });

describe('POST /auth/npi', () => {
  it('refuses a cross-origin or origin-less POST', async () => {
    for (const origin of ['https://evil.example', null]) expect((await post(start, { npi: '123' }, origin)).status).toBe(403);
    expect(servers.calls).toHaveLength(0);
  });

  it('answers 404 when the option is off', async () => {
    vi.stubEnv('NPI_SIMULATED_LOGIN', '');
    expect((await post(start, { npi: '123' })).status).toBe(404);
    expect(servers.calls).toHaveLength(0);
  });

  it.each([{ npi: 'abc' }, { npi: '' }, { npi: '1'.repeat(21) }, { npi: 123 }, {}, 'not json'])('rejects the input %j with 400', async (body) => {
    expect((await post(start, body)).status).toBe(400);
    expect(servers.callsTo('/identity')).toHaveLength(0);
  });

  it('stores the challenge in the session and never returns its token', async () => {
    const response = await post(start, { npi: '0123456789' });
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toContain('challenge-secret');
    expect(Object.keys(JSON.parse(text)).sort()).toEqual(['expiresAt', 'simulated']);
    expect(JSON.parse(servers.callsTo('/identity/npi')[0].body)).toEqual({ npi: '0123456789' });
    expect((await readSession()).npiChallenge?.token).toBe('challenge-secret');
    expect(jar.get('ad_session')).not.toContain('challenge-secret');
  });

  it.each([400, 401, 429])('forwards %i', async (status) => {
    servers.npiStartStatus = status;
    expect((await post(start, { npi: '1' })).status).toBe(status);
    expect((await readSession()).npiChallenge).toBeUndefined();
  });

  it.each([404, 500, 503])('turns Backend %i into 503', async (status) => {
    servers.npiStartStatus = status;
    expect((await post(start, { npi: '1' })).status).toBe(503);
  });
});

describe('POST /auth/npi/verify', () => {
  it('refuses a cross-origin POST, answers 404 when off, 400 on a bad code', async () => {
    await writeSession({ npiChallenge: challenge() });
    expect((await post(verify, { code: '1' }, 'https://evil.example')).status).toBe(403);
    expect((await post(verify, { code: 'abcd' })).status).toBe(400);
    expect((await post(verify, { code: '1'.repeat(13) })).status).toBe(400);
    vi.stubEnv('NPI_SIMULATED_LOGIN', '');
    expect((await post(verify, { code: '1' })).status).toBe(404);
    expect(servers.callsTo('/identity')).toHaveLength(0);
  });

  it('answers 401 without a challenge or with an expired one', async () => {
    expect((await post(verify, { code: '1234' })).status).toBe(401);
    await writeSession({ npiChallenge: challenge(-1000) });
    expect((await post(verify, { code: '1234' })).status).toBe(401);
    expect(servers.callsTo('/identity')).toHaveLength(0);
  });

  it('opens a citizen session and drops the challenge', async () => {
    await writeSession({ npiChallenge: challenge() });
    const response = await post(verify, { code: '000000' });
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ attachFailed: false });
    expect(JSON.parse(servers.callsTo('/npi/verify')[0].body)).toEqual({ challengeToken: 'challenge-secret', code: '000000' });
    const { user, npiChallenge } = await readSession();
    expect(npiChallenge).toBeUndefined();
    expect(user).toMatchObject({ refreshToken: '', sub: 'npi-user-1', name: 'Usager', roles: ['citizen'], provider: 'npi' });
    expect(user!.accessExpiresAt).toBe(user!.refreshExpiresAt);
    expect(user!.accessExpiresAt).toBeGreaterThan(Date.now() + 11 * 3600_000);
    expect(text).not.toContain(user!.accessToken);
  });

  it('attaches the guest conversation and drops the guest when accepted', async () => {
    await writeSession({ guest: guest(), npiChallenge: challenge() });
    const response = await post(verify, { code: '1', conversationId: CNV });
    expect(await response.json()).toEqual({ attachFailed: false });
    const [call] = servers.callsTo('/attach');
    expect(call.url).toContain(CNV);
    expect(call.headers.get('authorization')).toBe(`Bearer ${(await readSession()).user!.accessToken}`);
    expect(JSON.parse(call.body)).toEqual({ guestToken: 'guest-tok' });
    expect((await readSession()).guest).toBeUndefined();
  });

  it('keeps the guest and reports the failure when the attach is refused', async () => {
    servers.attachStatus = 403;
    await writeSession({ guest: guest(), npiChallenge: challenge() });
    const response = await post(verify, { code: '1', conversationId: CNV });
    expect(await response.json()).toEqual({ attachFailed: true });
    const session = await readSession();
    expect(session.guest?.token).toBe('guest-tok');
    expect(session.user).toBeDefined();
  });

  it('ignores a malformed conversationId and attaches nothing without a guest', async () => {
    await writeSession({ guest: guest(), npiChallenge: challenge() });
    await post(verify, { code: '1', conversationId: 'cnv_nope' });
    await writeSession({ npiChallenge: challenge() });
    await post(verify, { code: '1', conversationId: CNV });
    expect(servers.callsTo('/attach')).toHaveLength(0);
  });

  it.each([400, 401, 429])('forwards %i and keeps the challenge for 400/429 retries', async (status) => {
    await writeSession({ npiChallenge: challenge() });
    servers.npiVerifyStatus = status;
    expect((await post(verify, { code: '1' })).status).toBe(status);
    expect((await readSession()).user).toBeUndefined();
  });

  it('turns an unexpected Backend status into 503', async () => {
    await writeSession({ npiChallenge: challenge() });
    servers.npiVerifyStatus = 500;
    expect((await post(verify, { code: '1' })).status).toBe(503);
  });
});
