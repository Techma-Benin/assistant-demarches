// Proxy of the operator screen (contracts/v2/operator.openapi.json): exact allowlist, bearer added server-side.
const ID = /^[A-Za-z0-9_-]{1,80}$/;
const TOOL_NAME = /^[A-Za-z0-9_.:-]{1,200}$/;
const MODELS = '/v1/operator/models';
const SERVERS = '/v1/operator/mcp-servers';
const STATUS = '/v1/operator/status';

const FORWARDED_REQUEST_HEADERS = ['content-type', 'traceparent'];
const FORWARDED_RESPONSE_HEADERS = ['content-type', 'retry-after'];
// Configuration documents stay small.
const MAX_JSON_BYTES = 64 * 1024;

export interface OperatorProxyDeps {
  backendUrl: string;
  token: string;
  fetch: typeof fetch;
}

function problem(status: number, code: string, detail: string, request: Request, extra?: HeadersInit): Response {
  const traceId = /^00-([a-f0-9]{32})-/.exec(request.headers.get('traceparent') ?? '')?.[1] ?? '0'.repeat(32);
  return new Response(
    JSON.stringify({ type: 'about:blank', title: code, status, detail, code, traceId }),
    { status, headers: { 'content-type': 'application/problem+json', 'cache-control': 'no-store', ...extra } },
  );
}

/** Reads the body chunk by chunk and stops as soon as `limit` is exceeded (null). */
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

/** Keeps only `cursor` and `limit`; null when one is invalid or repeated. */
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

interface Route {
  target: string;
  query: URLSearchParams;
  body: boolean;
}

const enc = encodeURIComponent;

/** Maps method + path (+ query) to a backend target; 'notFound' / 'invalidQuery' otherwise. */
function resolveRoute(method: string, pathname: string, search: URLSearchParams): Route | 'notFound' | 'invalidQuery' {
  const noQuery = [...search.keys()].length === 0;
  const route = (target: string, body = false, query = new URLSearchParams()): Route => ({ target, query, body });
  const segments = pathname.split('/'); // ['', 'v1', 'operator', kind, id?, tail?, toolName?]
  if (segments[1] !== 'v1' || segments[2] !== 'operator') return 'notFound';

  if (pathname === STATUS) return method === 'GET' ? (noQuery ? route(STATUS) : 'invalidQuery') : 'notFound';

  for (const base of [MODELS, SERVERS]) {
    if (pathname === base) {
      if (method === 'GET') {
        const query = listQuery(search);
        return query ? route(base, false, query) : 'invalidQuery';
      }
      if (method === 'POST') return noQuery ? route(base, true) : 'invalidQuery';
      return 'notFound';
    }
    if (!pathname.startsWith(base + '/')) continue;
    const rest = pathname.slice(base.length + 1).split('/');
    const id = rest[0];
    if (!ID.test(id)) return 'notFound';
    const item = `${base}/${enc(id)}`;
    if (rest.length === 1) {
      if (method === 'GET' || method === 'DELETE') return noQuery ? route(item) : 'invalidQuery';
      if (method === 'PUT') return noQuery ? route(item, true) : 'invalidQuery';
      return 'notFound';
    }
    if (base !== SERVERS) return 'notFound';
    if (rest.length === 2 && rest[1] === 'discover') {
      return method === 'POST' ? (noQuery ? route(`${item}/discover`) : 'invalidQuery') : 'notFound';
    }
    if (rest.length === 2 && rest[1] === 'tools') {
      return method === 'GET' ? (noQuery ? route(`${item}/tools`) : 'invalidQuery') : 'notFound';
    }
    if (rest.length === 3 && rest[1] === 'tools') {
      if (method !== 'PUT' || !TOOL_NAME.test(rest[2]) || rest[2] === '.' || rest[2] === '..') return 'notFound';
      return noQuery ? route(`${item}/tools/${enc(rest[2])}`, true) : 'invalidQuery';
    }
    return 'notFound';
  }
  return 'notFound';
}

export async function proxyToOperator(request: Request, path: string[], deps: OperatorProxyDeps): Promise<Response> {
  if (path.some((segment) => segment === '' || /[/\\%]/.test(segment))) {
    return problem(404, 'NOT_FOUND', 'Route inconnue', request);
  }
  const method = request.method.toUpperCase();
  const resolved = resolveRoute(method, '/' + path.join('/'), new URL(request.url).searchParams);
  if (resolved === 'notFound') return problem(404, 'NOT_FOUND', 'Route inconnue', request);
  if (resolved === 'invalidQuery') return problem(400, 'INVALID_REQUEST', 'Paramètres de requête invalides', request);
  const { target, query, body: hasBody } = resolved;

  const tooLarge = () => problem(400, 'INVALID_REQUEST', 'Corps de requête trop volumineux', request);
  if (hasBody) {
    if (!(request.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) {
      return problem(415, 'UNSUPPORTED_MEDIA_TYPE', 'Corps JSON attendu', request);
    }
    if (Number(request.headers.get('content-length')) > MAX_JSON_BYTES) return tooLarge();
  }

  const headers = new Headers();
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value !== null && (hasBody || name !== 'content-type')) headers.set(name, value);
  }
  headers.set('authorization', `Bearer ${deps.token}`);

  let upstream: Response;
  try {
    const body = hasBody ? await readCapped(request, MAX_JSON_BYTES) : undefined;
    if (body === null) return tooLarge();
    const url = new URL(target, deps.backendUrl);
    url.search = query.toString();
    upstream = await deps.fetch(url, { method, headers, body });
  } catch {
    return problem(503, 'UPSTREAM_UNAVAILABLE', 'Service momentanément indisponible', request, { 'retry-after': '1' });
  }

  const responseHeaders = new Headers({ 'cache-control': 'no-store' });
  for (const name of FORWARDED_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value !== null) responseHeaders.set(name, value);
  }
  const noBody = [204, 205, 304].includes(upstream.status);
  return new Response(noBody ? null : await upstream.arrayBuffer(), { status: upstream.status, headers: responseHeaders });
}
