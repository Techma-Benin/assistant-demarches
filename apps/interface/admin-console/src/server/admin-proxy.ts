const LIST_PATH = /^\/v1\/admin\/(models|tools|procedures|conversations|audit)$/;
const METRICS_PATH = '/v1/admin/metrics';
const UPDATE_PATH = /^\/v1\/admin\/(models|tools|procedures)\/([^/]+)$/;

const FORWARDED_REQUEST_HEADERS = ['content-type', 'idempotency-key', 'traceparent'];
const FORWARDED_RESPONSE_HEADERS = ['content-type', 'retry-after'];
const DOCUMENT_RESPONSE_HEADERS = ['content-type', 'content-disposition', 'content-length'];
// Pièces justificatives: plafond de streaming, au-delà la réponse est refusée.
const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;

// Department-admin routes (contracts/v1/department-admin.openapi.json).
const DEPARTMENT_LISTS: Record<string, readonly string[]> = {
  '/v1/admin/me': [],
  '/v1/admin/departments': ['cursor', 'limit'],
  '/v1/admin/users': ['departmentId', 'cursor', 'limit'],
  '/v1/admin/work-items': ['departmentId', 'status', 'cursor', 'limit'],
  '/v1/admin/dashboard': ['departmentId', 'from', 'to'],
  '/v1/admin/activity': ['departmentId', 'cursor', 'limit'],
  '/v1/admin/unanswered': ['departmentId', 'cursor', 'limit'],
};
const WORK_ITEM_PATH = /^\/v1\/admin\/work-items\/([^/]+)$/;
const WORK_ITEM_ACTIONS_PATH = /^\/v1\/admin\/work-items\/([^/]+)\/actions$/;
const DOCUMENT_PATH = /^\/v1\/admin\/work-items\/([^/]+)\/documents\/([^/]+)$/;
const RESOLVE_PATH = /^\/v1\/admin\/unanswered\/([^/]+)\/resolve$/;
const MAX_ID_LENGTH = 128;
const STATUSES = new Set(['pending', 'completed', 'draft', 'all']);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T[0-9:.]{5,12}(Z|[+-]\d{2}:\d{2}))?$/;
const DEPARTMENT_ID = /^[A-Za-z0-9_-]{1,100}$/;

export interface ProxyDeps {
  backendUrl: string;
  getAdminToken: () => string;
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

/** Strict query for the department routes: only `allowed` names, each once and valid; null otherwise. */
function strictQuery(search: URLSearchParams, allowed: readonly string[]): URLSearchParams | null {
  const out = new URLSearchParams();
  for (const name of new Set(search.keys())) {
    if (!allowed.includes(name)) return null;
    const values = search.getAll(name);
    if (values.length !== 1) return null;
    const value = values[0];
    const valid =
      name === 'cursor'
        ? value.length >= 1 && value.length <= 256
        : name === 'limit'
          ? /^[0-9]{1,3}$/.test(value) && +value >= 1 && +value <= 100
          : name === 'status'
            ? STATUSES.has(value)
            : name === 'departmentId'
              ? DEPARTMENT_ID.test(value)
              : ISO_DATE.test(value) && !Number.isNaN(Date.parse(value)); // from, to
    if (!valid) return null;
    out.set(name, value);
  }
  return out;
}

/** Streams a document through with its type/disposition; refuses anything beyond MAX_DOCUMENT_BYTES. */
function documentResponse(upstream: Response, request: Request): Response {
  if (!upstream.ok || !upstream.body) {
    // Errors (problem+json) are small: same path as any other response.
    return new Response(upstream.body ? upstream.body : null, {
      status: upstream.status,
      headers: pick(upstream, FORWARDED_RESPONSE_HEADERS),
    });
  }
  const declared = Number(upstream.headers.get('content-length'));
  if (declared > MAX_DOCUMENT_BYTES) {
    void upstream.body.cancel();
    return problem(502, 'UPSTREAM_UNAVAILABLE', 'Document trop volumineux', request);
  }
  let total = 0;
  const capped = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      total += chunk.byteLength;
      if (total > MAX_DOCUMENT_BYTES) controller.error(new Error('document too large'));
      else controller.enqueue(chunk);
    },
  });
  const headers = pick(upstream, DOCUMENT_RESPONSE_HEADERS);
  headers.set('x-content-type-options', 'nosniff');
  headers.set('cache-control', 'private, no-store');
  return new Response(upstream.body.pipeThrough(capped), { status: upstream.status, headers });
}

function pick(upstream: Response, names: readonly string[]): Headers {
  const headers = new Headers();
  for (const name of names) {
    const value = upstream.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  return headers;
}

interface Route {
  target: string;
  query: URLSearchParams;
  /** Body-carrying method (PUT legacy, POST department). */
  body: boolean;
  /** POST routes need an Idempotency-Key (8–128 chars). */
  idempotent: boolean;
  document: boolean;
}

const idOk = (id: string) => id.length <= MAX_ID_LENGTH;
const enc = encodeURIComponent;

/** Maps method + path (+ query) to a backend target; 'notFound' / 'invalidQuery' otherwise. */
function resolveRoute(method: string, pathname: string, search: URLSearchParams): Route | 'notFound' | 'invalidQuery' {
  const route = (target: string, query = new URLSearchParams(), extra: Partial<Route> = {}): Route => ({
    target,
    query,
    body: false,
    idempotent: false,
    document: false,
    ...extra,
  });
  if (method === 'GET') {
    if (LIST_PATH.test(pathname)) {
      const filtered = listQuery(search);
      return filtered ? route(pathname, filtered) : 'invalidQuery';
    }
    if (pathname === METRICS_PATH) return route(pathname);
    const allowed = DEPARTMENT_LISTS[pathname];
    if (allowed) {
      const query = strictQuery(search, allowed);
      return query ? route(pathname, query) : 'invalidQuery';
    }
    const document = DOCUMENT_PATH.exec(pathname);
    if (document) {
      const [, id, fileId] = document;
      if (!idOk(id) || !idOk(fileId)) return 'notFound';
      if ([...search.keys()].length > 0) return 'invalidQuery';
      return route(`/v1/admin/work-items/${enc(id)}/documents/${enc(fileId)}`, undefined, { document: true });
    }
    const item = WORK_ITEM_PATH.exec(pathname);
    if (item) {
      if (!idOk(item[1])) return 'notFound';
      if ([...search.keys()].length > 0) return 'invalidQuery';
      return route(`/v1/admin/work-items/${enc(item[1])}`);
    }
  } else if (method === 'PUT') {
    const update = UPDATE_PATH.exec(pathname);
    if (update) {
      if (update[2].length > MAX_ID_LENGTH) return 'notFound';
      return route(`/v1/admin/${update[1]}/${enc(update[2])}`, undefined, { body: true });
    }
  } else if (method === 'POST') {
    const action = WORK_ITEM_ACTIONS_PATH.exec(pathname);
    const resolve = RESOLVE_PATH.exec(pathname);
    const match = action ?? resolve;
    if (match) {
      if (!idOk(match[1])) return 'notFound';
      if ([...search.keys()].length > 0) return 'invalidQuery';
      const suffix = action ? 'work-items' : 'unanswered';
      const tail = action ? 'actions' : 'resolve';
      return route(`/v1/admin/${suffix}/${enc(match[1])}/${tail}`, undefined, { body: true, idempotent: true });
    }
  }
  return 'notFound';
}

export async function proxyToAdmin(request: Request, path: string[], deps: ProxyDeps): Promise<Response> {
  if (path.some((segment) => segment === '' || segment.includes('..') || /[/\\%]/.test(segment))) {
    return notFound(request);
  }
  const pathname = '/' + path.join('/');
  const method = request.method.toUpperCase();

  const resolved = resolveRoute(method, pathname, new URL(request.url).searchParams);
  if (resolved === 'notFound') return notFound(request);
  if (resolved === 'invalidQuery') {
    return invalid(request, /^\/v1\/admin\/(models|tools|procedures|conversations|audit)$/.test(pathname)
      ? 'Paramètres de pagination invalides'
      : 'Paramètres de requête invalides');
  }
  const { target, query, body: hasBody, idempotent, document } = resolved;

  const tooLarge = () => invalid(request, 'Corps de requête trop volumineux');
  // Reject early from the declared size; the streamed read below enforces the cap when it is absent or wrong.
  if (hasBody && Number(request.headers.get('content-length')) > MAX_JSON_BYTES) return tooLarge();
  if (idempotent) {
    const key = request.headers.get('idempotency-key') ?? '';
    if (key.length < 8 || key.length > 128) return invalid(request, 'En-tête Idempotency-Key requis');
  }

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
    const body = hasBody ? await readCapped(request, MAX_JSON_BYTES) : undefined;
    if (body === null) return tooLarge();
    const url = new URL(target, deps.backendUrl);
    url.search = query.toString();
    upstream = await deps.fetch(url, { method, headers, body });
  } catch {
    return problem(503, 'UPSTREAM_UNAVAILABLE', 'Service momentanément indisponible', request, {
      'retry-after': '1',
    });
  }

  if (document) return documentResponse(upstream, request);
  const noBody = [204, 205, 304].includes(upstream.status);
  return new Response(noBody ? null : await upstream.arrayBuffer(), {
    status: upstream.status,
    headers: pick(upstream, FORWARDED_RESPONSE_HEADERS),
  });
}
