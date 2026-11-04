// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { ADMINISTRATION_COOKIE, isAdministrationId, switchAdministration } from '@/server/admin-administration';

const post = (body: unknown, origin: string | null = 'http://localhost') =>
  new Request('http://localhost/api/admin-administration', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

describe('administration cookie', () => {
  it('accepts stable administration ids only', () => {
    for (const ok of ['justice', 'anip', 'enseignement-superieur']) expect(isAdministrationId(ok)).toBe(true);
    for (const bad of ['', 'J', 'Justice', '1abc', 'a b', 'a'.repeat(64), null, 3]) expect(isAdministrationId(bad)).toBe(false);
  });

  it('sets an HttpOnly cookie on the chosen administration', async () => {
    const response = await switchAdministration(post({ administrationId: 'justice' }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ administrationId: 'justice' });
    const cookie = response.headers.get('set-cookie')!;
    expect(cookie).toContain(`${ADMINISTRATION_COOKIE}=justice`);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
  });

  it('treats localhost and 127.0.0.1 as the same origin', async () => {
    const response = await switchAdministration(post({ administrationId: 'anip' }, 'http://127.0.0.1'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ administrationId: 'anip' });
  });

  it('refuses a foreign origin, a missing id, bad JSON and a department id', async () => {
    expect((await switchAdministration(post({ administrationId: 'justice' }, 'https://evil.example'))).status).toBe(403);
    expect((await switchAdministration(post({ administrationId: 'justice' }, null))).status).toBe(403);
    expect((await switchAdministration(post({ departmentId: 'justice' }))).status).toBe(400);
    expect((await switchAdministration(post({ administrationId: 'Not Valid' }))).status).toBe(400);
    expect((await switchAdministration(post('{oops'))).status).toBe(400);
    expect((await switchAdministration(post({ administrationId: 'x'.repeat(2000) }))).status).toBe(400);
  });
});
