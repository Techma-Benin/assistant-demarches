const ID = '[0-9A-HJKMNP-TV-Z]{26}';

const ALLOWLIST: ReadonlyArray<{ method: 'GET' | 'POST'; path: RegExp }> = [
  { method: 'POST', path: /^\/v1\/conversations$/ },
  { method: 'POST', path: new RegExp(`^/v1/conversations/cnv_${ID}/messages$`) },
  { method: 'GET', path: new RegExp(`^/v1/conversations/cnv_${ID}/events$`) },
  { method: 'POST', path: new RegExp(`^/v1/conversations/cnv_${ID}/socket-ticket$`) },
  { method: 'POST', path: new RegExp(`^/v1/conversations/cnv_${ID}/mandate-challenges$`) },
  { method: 'POST', path: new RegExp(`^/v1/conversations/cnv_${ID}/mandates$`) },
  { method: 'POST', path: new RegExp(`^/v1/conversations/cnv_${ID}/mandates/mdt_${ID}/revoke$`) },
  { method: 'GET', path: new RegExp(`^/v1/requests/req_${ID}$`) },
  { method: 'POST', path: /^\/v1\/files$/ },
];

const FORWARDED_REQUEST_HEADERS = ['content-type', 'idempotency-key', 'traceparent', 'x-file-mime-type'];
const FORWARDED_RESPONSE_HEADERS = ['content-type', 'retry-after'];

export interface ProxyDeps {
  backendUrl: string;
  getUserToken: () => string;
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

export async function proxyToBackend(request: Request, path: string[], deps: ProxyDeps): Promise<Response> {
  if (path.some((segment) => segment === '' || segment.includes('..') || /[/\\%]/.test(segment))) {
    return notFound(request);
  }
  const pathname = '/' + path.join('/');
  const method = request.method.toUpperCase();
  if (!ALLOWLIST.some((rule) => rule.method === method && rule.path.test(pathname))) {
    return notFound(request);
  }

  const headers = new Headers();
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }

  try {
    headers.set('authorization', `Bearer ${deps.getUserToken()}`);
  } catch (error) {
    // Configuration problem on our side: keep the cause in server logs, never in the response.
    console.error('[backend-proxy] user token unavailable:', (error as Error).message);
    return problem(503, 'UPSTREAM_UNAVAILABLE', 'Service momentanément indisponible', request, {
      'retry-after': '1',
    });
  }

  let upstream: Response;
  try {
    const body = method === 'POST' ? await request.arrayBuffer() : undefined;
    const url = new URL(pathname, deps.backendUrl);
    url.search = new URL(request.url).search;
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
