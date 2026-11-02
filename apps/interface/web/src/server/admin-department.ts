export const DEPARTMENT_COOKIE = 'admin_department';
const MAX_BODY_BYTES = 1024;
const DEPARTMENT_ID = /^[a-z0-9-]{1,64}$/;

export const isDepartmentId = (value: unknown): value is string =>
  typeof value === 'string' && DEPARTMENT_ID.test(value);

function problem(status: number, code: string, detail: string): Response {
  return new Response(
    JSON.stringify({ type: 'about:blank', title: code, status, detail, code, traceId: '0'.repeat(32) }),
    { status, headers: { 'content-type': 'application/problem+json' } },
  );
}

function cookie(name: string, value: string, url: URL): string {
  return `${name}=${value}; HttpOnly; SameSite=Lax; Path=/${url.protocol === 'https:' ? '; Secure' : ''}`;
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

/** `POST /api/admin-department` `{ departmentId }`: the Backend stays the authority on access. */
export async function switchDepartment(request: Request): Promise<Response> {
  const url = new URL(request.url);
  // Cross-site writes are refused: the Origin must be our own.
  if (request.headers.get('origin') !== url.origin) return problem(403, 'FORBIDDEN', 'Origine non autorisée');
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
  const departmentId = (value as { departmentId?: unknown } | null)?.departmentId;
  if (!isDepartmentId(departmentId)) return invalid('Ministère invalide');
  const headers = new Headers({ 'content-type': 'application/json', 'cache-control': 'no-store' });
  headers.append('set-cookie', cookie(DEPARTMENT_COOKIE, departmentId, url));
  return new Response(JSON.stringify({ departmentId }), { status: 200, headers });
}
