export const ADMINISTRATION_COOKIE = 'admin_administration';
const MAX_BODY_BYTES = 1024;
const ADMINISTRATION_ID = /^[a-z][a-z0-9-]{1,62}$/;

export const isAdministrationId = (value: unknown): value is string =>
  typeof value === 'string' && ADMINISTRATION_ID.test(value);

function problem(status: number, code: string, detail: string): Response {
  return new Response(
    JSON.stringify({ type: 'about:blank', title: code, status, detail, code, traceId: '0'.repeat(32) }),
    { status, headers: { 'content-type': 'application/problem+json' } },
  );
}

function cookie(name: string, value: string, url: URL): string {
  return `${name}=${value}; HttpOnly; SameSite=Lax; Path=/${url.protocol === 'https:' ? '; Secure' : ''}`;
}

const loopback = (host: string) => host === 'localhost' || host === '127.0.0.1';

/** Same site as this request: identical origin, or localhost ↔ 127.0.0.1 on the same port. */
function isOwnOrigin(originHeader: string | null, url: URL): boolean {
  if (!originHeader) return false;
  try {
    const origin = new URL(originHeader);
    if (origin.protocol !== url.protocol || origin.port !== url.port) return false;
    return origin.hostname === url.hostname || (loopback(origin.hostname) && loopback(url.hostname));
  } catch {
    return false;
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

/** `POST /api/admin-administration` `{ administrationId }`: the Backend stays the authority on access. */
export async function switchAdministration(request: Request): Promise<Response> {
  const url = new URL(request.url);
  // Cross-site writes are refused: the Origin must be our own (localhost and 127.0.0.1 count as one).
  if (!isOwnOrigin(request.headers.get('origin'), url)) return problem(403, 'FORBIDDEN', 'Origine non autorisée');
  const invalid = (detail: string) => problem(400, 'INVALID_REQUEST', detail);
  if (Number(request.headers.get('content-length')) > MAX_BODY_BYTES) return invalid('Corps de requête trop volumineux');
  const text = await readBodyCapped(request, MAX_BODY_BYTES);
  if (text === null) return invalid('Corps de requête trop volumineux');
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return invalid('Corps JSON invalide');
  }
  const administrationId = (value as { administrationId?: unknown } | null)?.administrationId;
  if (!isAdministrationId(administrationId)) return invalid('Administration invalide');
  const headers = new Headers({ 'content-type': 'application/json', 'cache-control': 'no-store' });
  headers.append('set-cookie', cookie(ADMINISTRATION_COOKIE, administrationId, url));
  return new Response(JSON.stringify({ administrationId }), { status: 200, headers });
}
