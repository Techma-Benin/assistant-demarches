// Allowlist of the administration console routes (contracts/v2/admin.openapi.json). Nothing else is forwarded.

const FORWARDED_REQUEST_HEADERS = ['content-type', 'idempotency-key', 'traceparent', 'x-file-mime-type'];
const FORWARDED_RESPONSE_HEADERS = ['content-type', 'retry-after'];
const BINARY_RESPONSE_HEADERS = ['content-type', 'content-disposition', 'content-length'];

// Pièces justificatives et documents délivrés: plafond de streaming, au-delà la réponse est refusée.
const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;
// Photo de profil: 2 Mio (contrat), en entrée comme en sortie.
const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
// Corps JSON de la console (profil, agent, action sur un dossier): petits.
const MAX_JSON_BYTES = 64 * 1024;

const ULID = '[0-9A-HJKMNP-TV-Z]{26}';
const ID = {
  case: new RegExp(`^cas_${ULID}$`),
  document: new RegExp(`^doc_${ULID}$`),
  official: new RegExp(`^off_${ULID}$`),
  unanswered: new RegExp(`^unq_${ULID}$`),
};
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T[0-9:.]{5,12}(Z|[+-]\d{2}:\d{2})$/;

/** Validators of the query parameters the contract defines. */
const QUERY: Record<string, (value: string) => boolean> = {
  cursor: (v) => v.length >= 1 && v.length <= 4096,
  limit: (v) => /^[0-9]{1,3}$/.test(v) && +v >= 1 && +v <= 100,
  administrationId: (v) => /^[a-z][a-z0-9-]{1,62}$/.test(v),
  view: (v) => ['pending', 'completed', 'rejected', 'all'].includes(v),
  status: (v) => v === 'open' || v === 'resolved',
  caseId: (v) => ID.case.test(v),
  from: (v) => ISO_DATE_TIME.test(v) && !Number.isNaN(Date.parse(v)),
  to: (v) => ISO_DATE_TIME.test(v) && !Number.isNaN(Date.parse(v)),
};

interface RouteSpec {
  method: 'GET' | 'PUT' | 'POST';
  path: RegExp;
  /** One validator per capture group of `path`. */
  ids?: RegExp[];
  query?: string[];
  requiredQuery?: string[];
  body?: 'json' | 'binary';
  /** Binary responses are streamed with their type/disposition, under a size cap. */
  binary?: number;
  /** The route needs a `Idempotency-Key` (8–128 chars). */
  idempotent?: boolean;
  /** `X-File-Mime-Type` must be image/jpeg or image/png. */
  imageMime?: boolean;
}

const CURSOR = ['cursor', 'limit'];

const ROUTES: RouteSpec[] = [
  { method: 'GET', path: /^\/v1\/admin\/me$/ },
  { method: 'PUT', path: /^\/v1\/admin\/me$/, body: 'json' },
  { method: 'PUT', path: /^\/v1\/admin\/me\/avatar$/, body: 'binary', imageMime: true },
  { method: 'GET', path: /^\/v1\/admin\/avatars\/([^/]+)$/, ids: [ID.official], binary: MAX_AVATAR_BYTES },
  { method: 'GET', path: /^\/v1\/admin\/administrations$/ },
  { method: 'GET', path: /^\/v1\/admin\/officials$/, query: ['administrationId', ...CURSOR] },
  { method: 'POST', path: /^\/v1\/admin\/officials$/, body: 'json' },
  { method: 'PUT', path: /^\/v1\/admin\/officials\/([^/]+)$/, ids: [ID.official], body: 'json' },
  {
    method: 'GET',
    path: /^\/v1\/admin\/cases$/,
    query: ['administrationId', 'view', ...CURSOR],
    requiredQuery: ['view'],
  },
  { method: 'GET', path: /^\/v1\/admin\/cases\/([^/]+)$/, ids: [ID.case] },
  {
    method: 'POST',
    path: /^\/v1\/admin\/cases\/([^/]+)\/actions$/,
    ids: [ID.case],
    body: 'json',
    idempotent: true,
  },
  {
    method: 'GET',
    path: /^\/v1\/admin\/cases\/([^/]+)\/documents\/([^/]+)$/,
    ids: [ID.case, ID.document],
    binary: MAX_DOCUMENT_BYTES,
  },
  { method: 'GET', path: /^\/v1\/admin\/dashboard$/, query: ['administrationId', 'from', 'to'] },
  { method: 'GET', path: /^\/v1\/admin\/activity$/, query: ['administrationId', 'caseId', ...CURSOR] },
  { method: 'GET', path: /^\/v1\/admin\/unanswered$/, query: ['administrationId', 'status', ...CURSOR] },
  { method: 'POST', path: /^\/v1\/admin\/unanswered\/([^/]+)\/resolve$/, ids: [ID.unanswered] },
];

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

/** Strict query: only the route’s own parameters, each once and valid; null otherwise. */
function strictQuery(search: URLSearchParams, route: RouteSpec): URLSearchParams | null {
  const allowed = route.query ?? [];
  const out = new URLSearchParams();
  for (const name of new Set(search.keys())) {
    if (!allowed.includes(name)) return null;
    const values = search.getAll(name);
    if (values.length !== 1 || !QUERY[name](values[0])) return null;
    out.set(name, values[0]);
  }
  for (const name of route.requiredQuery ?? []) if (!out.has(name)) return null;
  return out;
}

function pick(upstream: Response, names: readonly string[]): Headers {
  const headers = new Headers();
  for (const name of names) {
    const value = upstream.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  return headers;
}

/** Streams a binary (document, photo) through with its type/disposition; refuses anything beyond `max`. */
function binaryResponse(upstream: Response, request: Request, max: number): Response {
  if (!upstream.ok || !upstream.body) {
    // Errors (problem+json) are small: same path as any other response.
    return new Response(upstream.body ? upstream.body : null, {
      status: upstream.status,
      headers: pick(upstream, FORWARDED_RESPONSE_HEADERS),
    });
  }
  const declared = Number(upstream.headers.get('content-length'));
  if (declared > max) {
    void upstream.body.cancel();
    return problem(502, 'UPSTREAM_UNAVAILABLE', 'Fichier trop volumineux', request);
  }
  let total = 0;
  const capped = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      total += chunk.byteLength;
      if (total > max) controller.error(new Error('file too large'));
      else controller.enqueue(chunk);
    },
  });
  const headers = pick(upstream, BINARY_RESPONSE_HEADERS);
  headers.set('x-content-type-options', 'nosniff');
  headers.set('cache-control', 'private, no-store');
  return new Response(upstream.body.pipeThrough(capped), { status: upstream.status, headers });
}

/** Matches method + path; null when no route matches. */
function matchRoute(method: string, pathname: string): RouteSpec | null {
  for (const route of ROUTES) {
    if (route.method !== method) continue;
    const match = route.path.exec(pathname);
    if (!match) continue;
    const ids = route.ids ?? [];
    if (ids.every((pattern, index) => pattern.test(match[index + 1]))) return route;
  }
  return null;
}

export async function proxyToAdmin(request: Request, path: string[], deps: ProxyDeps): Promise<Response> {
  if (path.some((segment) => segment === '' || segment.includes('..') || /[/\\%]/.test(segment))) {
    return notFound(request);
  }
  const pathname = '/' + path.join('/');
  const method = request.method.toUpperCase();

  const route = matchRoute(method, pathname);
  if (!route) return notFound(request);
  const query = strictQuery(new URL(request.url).searchParams, route);
  if (!query) return invalid(request, 'Paramètres de requête invalides');

  const bodyLimit = route.body === 'binary' ? MAX_AVATAR_BYTES : MAX_JSON_BYTES;
  const tooLarge = () =>
    route.body === 'binary'
      ? problem(413, 'FILE_TOO_LARGE', 'Image trop volumineuse (2 Mio maximum)', request)
      : invalid(request, 'Corps de requête trop volumineux');
  // Reject early from the declared size; the streamed read below enforces the cap when it is absent or wrong.
  if (route.body && Number(request.headers.get('content-length')) > bodyLimit) return tooLarge();
  if (route.idempotent) {
    const key = request.headers.get('idempotency-key') ?? '';
    if (key.length < 8 || key.length > 128) return invalid(request, 'En-tête Idempotency-Key requis');
  }
  if (route.imageMime) {
    const mime = request.headers.get('x-file-mime-type');
    if (mime !== 'image/jpeg' && mime !== 'image/png') {
      return problem(415, 'UNSUPPORTED_MEDIA_TYPE', 'Image JPEG ou PNG requise', request);
    }
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
    const body = route.body ? await readCapped(request, bodyLimit) : undefined;
    if (body === null) return tooLarge();
    const url = new URL(pathname, deps.backendUrl);
    url.search = query.toString();
    upstream = await deps.fetch(url, { method, headers, body });
  } catch {
    return problem(503, 'UPSTREAM_UNAVAILABLE', 'Service momentanément indisponible', request, {
      'retry-after': '1',
    });
  }

  if (route.binary) return binaryResponse(upstream, request, route.binary);
  const noBody = [204, 205, 304].includes(upstream.status);
  return new Response(noBody ? null : await upstream.arrayBuffer(), {
    status: upstream.status,
    headers: pick(upstream, FORWARDED_RESPONSE_HEADERS),
  });
}
