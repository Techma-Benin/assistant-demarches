import { assertTokenAllowed } from '@/server/admin-token';

export const SESSION_COOKIE = 'admin_session';
export const DEPARTMENT_COOKIE = 'admin_department';
const MAX_SWITCH_BYTES = 1024;
const DEPARTMENT_ID = /^[a-z0-9-]{1,64}$/;

export interface DemoSession {
  id: string;
  label: string;
  token: string;
}

export const DEMO_SESSIONS: readonly DemoSession[] = [
  { id: 'justice', label: 'Agent Justice', token: 'mock-agent-justice' },
  { id: 'enseignement', label: 'Agent Enseignement', token: 'mock-agent-enseignement' },
  { id: 'super', label: 'Super admin', token: 'mock-super-admin' },
];

export const DEFAULT_SESSION_ID = DEMO_SESSIONS[0].id;

/** `ADMIN_DEMO_TOKENS` (JSON object id → token) replaces the mock tokens, e.g. to target a real local Backend. */
function tokenOverrides(): Record<string, unknown> {
  const raw = process.env.ADMIN_DEMO_TOKENS;
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function findSession(id: string | undefined): DemoSession | undefined {
  return DEMO_SESSIONS.find((session) => session.id === id);
}

/** Token of a session, with the same guards as the legacy admin token. Never sent to the browser. */
export function getSessionToken(sessionId: string): string {
  const session = findSession(sessionId) ?? DEMO_SESSIONS[0];
  const override = tokenOverrides()[session.id];
  const token = typeof override === 'string' && override !== '' ? override : session.token;
  return assertTokenAllowed(token);
}

export function readCookie(request: Request, name: string): string | undefined {
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return undefined;
}

export function activeSessionId(request: Request): string {
  return findSession(readCookie(request, SESSION_COOKIE))?.id ?? DEFAULT_SESSION_ID;
}

/** Token of the session selected by the `admin_session` cookie (default: first demo session). */
export function getToken(request: Request): string {
  return getSessionToken(activeSessionId(request));
}

function problem(status: number, code: string, detail: string, extra?: HeadersInit): Response {
  return new Response(
    JSON.stringify({ type: 'about:blank', title: code, status, detail, code, traceId: '0'.repeat(32) }),
    { status, headers: { 'content-type': 'application/problem+json', ...extra } },
  );
}

const unavailable = () =>
  problem(503, 'UPSTREAM_UNAVAILABLE', 'Service momentanément indisponible', { 'retry-after': '1' });

function sessionBody(activeSessionId: string): string {
  return JSON.stringify({
    sessions: DEMO_SESSIONS.map(({ id, label }) => ({ id, label })),
    activeSessionId,
  });
}

function jsonResponse(body: string, extra?: HeadersInit): Response {
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...extra },
  });
}

function cookie(name: string, value: string, url: URL, maxAge?: number): string {
  return `${name}=${value}; HttpOnly; SameSite=Lax; Path=/${url.protocol === 'https:' ? '; Secure' : ''}${
    maxAge === undefined ? '' : `; Max-Age=${maxAge}`
  }`;
}

/** `GET /api/session`: available sessions and the active one. Fails like the token guard (503) in production. */
export function currentSession(request: Request): Response {
  const id = activeSessionId(request);
  try {
    getSessionToken(id);
  } catch (error) {
    console.error('[session] unavailable:', (error as Error).message);
    return unavailable();
  }
  return jsonResponse(sessionBody(id));
}

async function readBodyCapped(request: Request, limit: number): Promise<string | null> {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** Same-origin check, 1 KiB cap and JSON parse shared by both POST routes. Returns the parsed value or a Response. */
async function readSwitchBody(request: Request): Promise<{ value: unknown } | Response> {
  const url = new URL(request.url);
  // Cross-site writes are refused: the Origin must be our own.
  if (request.headers.get('origin') !== url.origin) {
    return problem(403, 'FORBIDDEN', 'Origine non autorisée');
  }
  const invalid = (detail: string) => problem(400, 'INVALID_REQUEST', detail);
  if (Number(request.headers.get('content-length')) > MAX_SWITCH_BYTES) return invalid('Corps de requête trop volumineux');
  const text = await readBodyCapped(request, MAX_SWITCH_BYTES);
  if (text === null) return invalid('Corps de requête trop volumineux');
  try {
    return { value: JSON.parse(text) };
  } catch {
    return invalid('Corps JSON invalide');
  }
}

/** `POST /api/session` `{ sessionId }`: selects the demo session and clears the department choice. */
export async function switchSession(request: Request): Promise<Response> {
  const body = await readSwitchBody(request);
  if (body instanceof Response) return body;
  const sessionId = (body.value as { sessionId?: unknown } | null)?.sessionId;
  const session = typeof sessionId === 'string' ? findSession(sessionId) : undefined;
  if (!session) return problem(400, 'INVALID_REQUEST', 'Session inconnue');
  try {
    getSessionToken(session.id);
  } catch (error) {
    console.error('[session] unavailable:', (error as Error).message);
    return unavailable();
  }
  const url = new URL(request.url);
  const headers = new Headers({ 'content-type': 'application/json', 'cache-control': 'no-store' });
  headers.append('set-cookie', cookie(SESSION_COOKIE, session.id, url));
  headers.append('set-cookie', cookie(DEPARTMENT_COOKIE, '', url, 0));
  return new Response(sessionBody(session.id), { status: 200, headers });
}

/** `POST /api/session/department` `{ departmentId }`: the Backend stays the authority on access. */
export async function switchDepartment(request: Request): Promise<Response> {
  const body = await readSwitchBody(request);
  if (body instanceof Response) return body;
  const departmentId = (body.value as { departmentId?: unknown } | null)?.departmentId;
  if (typeof departmentId !== 'string' || !DEPARTMENT_ID.test(departmentId)) {
    return problem(400, 'INVALID_REQUEST', 'Ministère invalide');
  }
  const headers = new Headers({ 'content-type': 'application/json', 'cache-control': 'no-store' });
  headers.append('set-cookie', cookie(DEPARTMENT_COOKIE, departmentId, new URL(request.url)));
  return new Response(JSON.stringify({ departmentId }), { status: 200, headers });
}
