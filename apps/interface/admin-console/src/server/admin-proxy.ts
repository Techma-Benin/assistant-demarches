import { can, type Capability, type Identity } from '@/lib/permissions';

const LIST_PATH = /^\/v1\/admin\/(models|tools|procedures|conversations|audit)$/;
const METRICS_PATH = '/v1/admin/metrics';
const UPDATE_PATH = /^\/v1\/admin\/(models|tools|procedures)\/([^/]+)$/;

const FORWARDED_REQUEST_HEADERS = ['content-type', 'idempotency-key', 'traceparent'];
const FORWARDED_RESPONSE_HEADERS = ['content-type', 'retry-after'];

export interface ProxyDeps {
  backendUrl: string;
  getAdminToken: () => string;
  getIdentity: (request: Request) => Identity | null;
  fetch: typeof fetch;
}

function problem(status: number, code: string, detail: string, request: Request, extra?: HeadersInit): Response {
  const traceId = /^00-([a-f0-9]{32})-/.exec(request.headers.get('traceparent') ?? '')?.[1] ?? '0'.repeat(32);
  return new Response(
    JSON.stringify({ type: 'about:blank', title: code, status, detail, code, traceId }),
    { status, headers: { 'content-type': 'application/problem+json', ...extra } },
  );
}

const notFound = (request: Request) => problem(404, 'NOT_FOUND', 'Route inconnue', request);
const invalid = (request: Request, detail: string) => problem(400, 'INVALID_REQUEST', detail, request);

// Configuration documents (model, tool, procedure with its form schema) stay small.
const MAX_JSON_BYTES = 64 * 1024;

/** Reads the body chunk by chunk and stops as soon as `limit` is exceeded (null), never buffering more. */
async function readCapped(request: Request, limit: number): Promise<ArrayBuffer | null> {
  if (!request.body) return new ArrayBuffer(0);
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
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body.buffer;
}

/** Keeps only `cursor` and `limit`; null when one is invalid or repeated. Other parameters are dropped. */
function listQuery(search: URLSearchParams): URLSearchParams | null {
  const cursors = search.getAll('cursor');
  const limits = search.getAll('limit');
  if (cursors.length > 1 || limits.length > 1) return null;
  const out = new URLSearchParams();
  if (cursors.length === 1) {
    if (cursors[0].length < 1 || cursors[0].length > 256) return null;
    out.set('cursor', cursors[0]);
  }
  if (limits.length === 1) {
    if (!/^[0-9]{1,3}$/.test(limits[0]) || +limits[0] < 1 || +limits[0] > 100) return null;
    out.set('limit', limits[0]);
  }
  return out;
}

export async function proxyToAdmin(request: Request, path: string[], deps: ProxyDeps): Promise<Response> {
  if (path.some((segment) => segment === '' || segment.includes('..') || /[/\\%]/.test(segment))) {
    return notFound(request);
  }
  const pathname = '/' + path.join('/');
  const method = request.method.toUpperCase();

  let target: string;
  let capability: Capability;
  let query = new URLSearchParams();
  const search = new URL(request.url).searchParams;
  if (method === 'GET' && LIST_PATH.test(pathname)) {
    const filtered = listQuery(search);
    if (!filtered) return invalid(request, 'Paramètres de pagination invalides');
    query = filtered;
    target = pathname;
    capability = `${LIST_PATH.exec(pathname)![1]}.view` as Capability;
  } else if (method === 'GET' && pathname === METRICS_PATH) {
    target = pathname;
    capability = 'overview.view';
  } else if (method === 'PUT' && UPDATE_PATH.test(pathname)) {
    const [, resource, id] = UPDATE_PATH.exec(pathname)!;
    if (id.length > 128) return notFound(request);
    target = `/v1/admin/${resource}/${encodeURIComponent(id)}`;
    capability = `${resource}.edit` as Capability;
  } else {
    return notFound(request);
  }

  // Defence in depth only: the real token will carry `administrationId` and the Backend filters data by it.
  // The demo mock shares one token, so nothing is filtered here.
  const identity = deps.getIdentity(request);
  if (!identity) return problem(401, 'UNAUTHENTICATED', 'Session requise', request);
  if (!can(identity, capability)) {
    return problem(403, 'FORBIDDEN', 'Action non permise avec l’identité active', request);
  }

  const tooLarge = () => invalid(request, 'Corps de requête trop volumineux');
  // Reject early from the declared size; the streamed read below enforces the cap when it is absent or wrong.
  if (method === 'PUT' && Number(request.headers.get('content-length')) > MAX_JSON_BYTES) return tooLarge();

  const headers = new Headers();
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }

  try {
    headers.set('authorization', `Bearer ${deps.getAdminToken()}`);
  } catch (error) {
    // Configuration problem on our side: keep the cause in server logs, never in the response.
    console.error('[admin-proxy] admin token unavailable:', (error as Error).message);
    return problem(503, 'UPSTREAM_UNAVAILABLE', 'Service momentanément indisponible', request, {
      'retry-after': '1',
    });
  }

  let upstream: Response;
  try {
    const body = method === 'PUT' ? await readCapped(request, MAX_JSON_BYTES) : undefined;
    if (body === null) return tooLarge();
    const url = new URL(target, deps.backendUrl);
    url.search = query.toString();
    upstream = await deps.fetch(url, { method, headers, body });
  } catch {
    return problem(503, 'UPSTREAM_UNAVAILABLE', 'Service momentanément indisponible', request, {
      'retry-after': '1',
    });
  }

  const responseHeaders = new Headers();
  for (const name of FORWARDED_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value !== null) responseHeaders.set(name, value);
  }
  const noBody = [204, 205, 304].includes(upstream.status);
  return new Response(noBody ? null : await upstream.arrayBuffer(), {
    status: upstream.status,
    headers: responseHeaders,
  });
}
