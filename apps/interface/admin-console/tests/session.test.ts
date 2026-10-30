// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { currentSession, getToken, switchDepartment, switchSession } from '@/server/session';

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'development');
  vi.stubEnv('BACKEND_URL', 'http://127.0.0.1:4010');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const ORIGIN = 'http://localhost:3100';
const post = (path: string, body: BodyInit, headers: Record<string, string> = { origin: ORIGIN }) =>
  new Request(`${ORIGIN}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body });
const withCookie = (cookie?: string) =>
  new Request(`${ORIGIN}/api/session`, { headers: cookie ? { cookie } : {} });

describe('GET /api/session', () => {
  it('lists the sessions without any token, defaulting to justice', async () => {
    const response = currentSession(withCookie());
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const text = await response.text();
    expect(text).not.toContain('mock-');
    expect(text).not.toContain('token');
    expect(JSON.parse(text)).toEqual({
      sessions: [
        { id: 'justice', label: 'Agent Justice' },
        { id: 'enseignement', label: 'Agent Enseignement' },
        { id: 'super', label: 'Super admin' },
      ],
      activeSessionId: 'justice',
    });
  });

  it('reports the cookie session, and falls back to justice for an unknown one', async () => {
    expect((await currentSession(withCookie('admin_session=super')).json()).activeSessionId).toBe('super');
    expect((await currentSession(withCookie('x=1; admin_session=nope')).json()).activeSessionId).toBe('justice');
  });

  it('answers 503 in production without leaking the cause', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubEnv('NODE_ENV', 'production');
    const response = currentSession(withCookie());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('OIDC');
  });
});

describe('POST /api/session', () => {
  it('sets an HttpOnly SameSite=Lax cookie, clears the department, and returns no token', async () => {
    const response = await switchSession(post('/api/session', '{"sessionId":"enseignement"}'));
    expect(response.status).toBe(200);
    const cookies = response.headers.getSetCookie();
    expect(cookies).toContain('admin_session=enseignement; HttpOnly; SameSite=Lax; Path=/');
    expect(cookies.some((c) => c.startsWith('admin_department=;') && c.includes('Max-Age=0'))).toBe(true);
    const text = await response.text();
    expect(text).not.toContain('mock-');
    expect(JSON.parse(text).activeSessionId).toBe('enseignement');
  });

  it('adds Secure over https', async () => {
    const request = new Request('https://console.example/api/session', {
      method: 'POST',
      headers: { origin: 'https://console.example' },
      body: '{"sessionId":"super"}',
    });
    expect((await switchSession(request)).headers.getSetCookie()[0]).toContain('; Secure');
  });

  it('refuses a foreign or missing Origin with 403', async () => {
    for (const headers of [{ origin: 'https://evil.example' }, {}] as Array<Record<string, string>>) {
      expect((await switchSession(post('/api/session', '{"sessionId":"super"}', headers))).status).toBe(403);
    }
  });

  it('answers 400 for unknown ids, bad JSON and oversize bodies', async () => {
    for (const body of ['{"sessionId":"nope"}', '{"sessionId":3}', '{}', 'null', 'not json', `{"sessionId":"${'x'.repeat(2000)}"}`]) {
      const response = await switchSession(post('/api/session', body));
      expect(response.status, body.slice(0, 30)).toBe(400);
      expect(response.headers.getSetCookie()).toEqual([]);
    }
  });

  it('answers 503 in production', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubEnv('NODE_ENV', 'production');
    const response = await switchSession(post('/api/session', '{"sessionId":"super"}'));
    expect(response.status).toBe(503);
    expect(response.headers.getSetCookie()).toEqual([]);
  });
});

describe('POST /api/session/department', () => {
  it('sets the admin_department cookie', async () => {
    const response = await switchDepartment(post('/api/session/department', '{"departmentId":"enseignement-2"}'));
    expect(response.status).toBe(200);
    expect(response.headers.getSetCookie()).toEqual(['admin_department=enseignement-2; HttpOnly; SameSite=Lax; Path=/']);
  });

  it('checks the origin, size, JSON and the id shape', async () => {
    expect((await switchDepartment(post('/api/session/department', '{"departmentId":"a"}', {}))).status).toBe(403);
    for (const body of ['{"departmentId":"Justice"}', '{"departmentId":"a b"}', '{"departmentId":""}', `{"departmentId":"${'a'.repeat(65)}"}`, '{"departmentId":1}', '{', `{"departmentId":"${'a'.repeat(2000)}"}`]) {
      expect((await switchDepartment(post('/api/session/department', body))).status, body.slice(0, 30)).toBe(400);
    }
  });
});

describe('getToken', () => {
  const req = (cookie?: string) => withCookie(cookie);

  it('picks the token of the session cookie, justice by default', () => {
    expect(getToken(req())).toBe('mock-agent-justice');
    expect(getToken(req('admin_session=enseignement'))).toBe('mock-agent-enseignement');
    expect(getToken(req('admin_session=super'))).toBe('mock-super-admin');
    expect(getToken(req('admin_session=unknown'))).toBe('mock-agent-justice');
  });

  it('lets ADMIN_DEMO_TOKENS override tokens per id', () => {
    vi.stubEnv('ADMIN_DEMO_TOKENS', JSON.stringify({ super: 'real-jwt', justice: 3 }));
    expect(getToken(req('admin_session=super'))).toBe('real-jwt');
    expect(getToken(req())).toBe('mock-agent-justice');
    vi.stubEnv('ADMIN_DEMO_TOKENS', 'not json');
    expect(getToken(req('admin_session=super'))).toBe('mock-super-admin');
  });

  it('refuses mock tokens towards a non-loopback backend, but not real ones', () => {
    vi.stubEnv('BACKEND_URL', 'https://backend.example.org');
    expect(() => getToken(req())).toThrow();
    vi.stubEnv('ADMIN_DEMO_TOKENS', JSON.stringify({ justice: 'real-jwt' }));
    expect(getToken(req())).toBe('real-jwt');
  });

  it('refuses in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(() => getToken(req())).toThrow('Session OIDC administrateur non branchée');
  });
});
