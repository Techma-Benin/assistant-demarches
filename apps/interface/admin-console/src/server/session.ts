import type { Identity, Session } from '@/lib/permissions';
import { getAdminToken } from '@/server/admin-token';

export const IDENTITY_COOKIE = 'admin_identity';
const DISPLAY_NAME = 'Agent de démonstration';
const MAX_SWITCH_BYTES = 1024;

export const DEMO_SESSION_IDENTITIES: Identity[] = [
  { id: 'idt_platform', kind: 'platform', label: 'Équipe Techma', access: 'write' },
  {
    id: 'idt_demo_write',
    kind: 'administration',
    administrationId: 'demo-administration',
    label: 'Administration de démonstration',
    access: 'write',
  },
  {
    id: 'idt_mairie_read',
    kind: 'administration',
    administrationId: 'mairie-fictive',
    label: 'Mairie fictive',
    access: 'read',
  },
];

/** Dev session: refuses in production and outside loopback exactly like the admin token (same guard). */
export function getSession(cookieValue: string | undefined): Session {
  getAdminToken();
  const active = DEMO_SESSION_IDENTITIES.find((identity) => identity.id === cookieValue) ?? DEMO_SESSION_IDENTITIES[0];
  return { displayName: DISPLAY_NAME, identities: DEMO_SESSION_IDENTITIES, activeIdentityId: active.id };
}

export function getActiveIdentity(cookieValue: string | undefined): Identity {
  const session = getSession(cookieValue);
  return session.identities.find((identity) => identity.id === session.activeIdentityId)!;
}

export function readIdentityCookie(request: Request): string | undefined {
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === IDENTITY_COOKIE) return rest.join('=');
  }
  return undefined;
}

function problem(status: number, code: string, detail: string, extra?: HeadersInit): Response {
  return new Response(
    JSON.stringify({ type: 'about:blank', title: code, status, detail, code, traceId: '0'.repeat(32) }),
    { status, headers: { 'content-type': 'application/problem+json', ...extra } },
  );
}

const unavailable = () =>
  problem(503, 'UPSTREAM_UNAVAILABLE', 'Service momentanément indisponible', { 'retry-after': '1' });

function sessionResponse(session: Session, extra?: HeadersInit): Response {
  return new Response(JSON.stringify(session), {
    status: 200,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...extra },
  });
}

export function currentSession(request: Request): Response {
  try {
    return sessionResponse(getSession(readIdentityCookie(request)));
  } catch (error) {
    console.error('[session] unavailable:', (error as Error).message);
    return unavailable();
  }
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

export async function switchIdentity(request: Request): Promise<Response> {
  const url = new URL(request.url);
  // Cross-site writes are refused: the Origin must be our own.
  if (request.headers.get('origin') !== url.origin) {
    return problem(403, 'FORBIDDEN', 'Origine non autorisée');
  }
  const invalid = (detail: string) => problem(400, 'INVALID_REQUEST', detail);
  if (Number(request.headers.get('content-length')) > MAX_SWITCH_BYTES) return invalid('Corps de requête trop volumineux');
  const text = await readBodyCapped(request, MAX_SWITCH_BYTES);
  if (text === null) return invalid('Corps de requête trop volumineux');

  let identityId: unknown;
  try {
    identityId = (JSON.parse(text) as { identityId?: unknown } | null)?.identityId;
  } catch {
    return invalid('Corps JSON invalide');
  }
  const identity =
    typeof identityId === 'string' ? DEMO_SESSION_IDENTITIES.find((candidate) => candidate.id === identityId) : undefined;
  if (!identity) return invalid('Identité inconnue');

  let session: Session;
  try {
    session = getSession(identity.id);
  } catch (error) {
    console.error('[session] unavailable:', (error as Error).message);
    return unavailable();
  }
  const cookie = `${IDENTITY_COOKIE}=${identity.id}; HttpOnly; SameSite=Lax; Path=/${url.protocol === 'https:' ? '; Secure' : ''}`;
  return sessionResponse(session, { 'set-cookie': cookie });
}
