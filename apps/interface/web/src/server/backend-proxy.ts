import { MAX_FILE_BYTES } from '@/lib/files';

const ID = '[0-9A-HJKMNP-TV-Z]{26}';

interface Rule {
  method: 'GET' | 'POST';
  path: RegExp;
  /** Public route: sent without Authorization. */
  public?: boolean;
  /** Binary download: streamed back with its type and disposition. */
  download?: boolean;
}

// Browser routes of contracts/v2/conversation.openapi.json. guest-sessions and attach stay server-side.
const ALLOWLIST: readonly Rule[] = [
  { method: 'POST', path: /^\/v1\/conversations$/ },
  { method: 'GET', path: /^\/v1\/conversations$/ },
  { method: 'POST', path: new RegExp(`^/v1/conversations/cnv_${ID}/messages$`) },
  { method: 'GET', path: new RegExp(`^/v1/conversations/cnv_${ID}/events$`) },
  { method: 'POST', path: new RegExp(`^/v1/conversations/cnv_${ID}/socket-ticket$`) },
  { method: 'POST', path: new RegExp(`^/v1/conversations/cnv_${ID}/mandates$`) },
  { method: 'POST', path: new RegExp(`^/v1/conversations/cnv_${ID}/mandates/mdt_${ID}/revoke$`) },
  { method: 'POST', path: /^\/v1\/files$/ },
  { method: 'POST', path: /^\/v1\/transcriptions$/ },
  { method: 'GET', path: /^\/v1\/home$/, public: true },
  { method: 'GET', path: /^\/v1\/cases$/ },
  { method: 'GET', path: new RegExp(`^/v1/cases/cas_${ID}$`) },
  { method: 'GET', path: new RegExp(`^/v1/cases/cas_${ID}/documents/doc_${ID}$`), download: true },
];

const FORWARDED_QUERY = ['cursor', 'limit'];
const FORWARDED_REQUEST_HEADERS = ['content-type', 'idempotency-key', 'traceparent', 'x-file-mime-type'];
const FORWARDED_RESPONSE_HEADERS = ['content-type', 'retry-after'];
const DOWNLOAD_RESPONSE_HEADERS = ['content-type', 'content-disposition', 'content-length'];

export interface ProxyDeps {
  backendUrl: string;
  /** User token, else guest token. May throw when no token can be obtained. */
  getBackendToken: () => Promise<string>;
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

// JSON routes carry small payloads (message text ≤ 4000 chars, form answers, consent).
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

export async function proxyToBackend(request: Request, path: string[], deps: ProxyDeps): Promise<Response> {
  if (path.some((segment) => segment === '' || segment.includes('..') || /[/\\%]/.test(segment))) {
    return notFound(request);
  }
  const pathname = '/' + path.join('/');
  const method = request.method.toUpperCase();
  const rule = ALLOWLIST.find((candidate) => candidate.method === method && candidate.path.test(pathname));
  if (!rule) return notFound(request);

  const isUpload = method === 'POST' && pathname === '/v1/files';
  const bodyLimit = isUpload ? MAX_FILE_BYTES : MAX_JSON_BYTES;
  const tooLarge = () =>
    isUpload
      ? problem(413, 'FILE_TOO_LARGE', '10 Mio maximum', request)
      : problem(400, 'INVALID_REQUEST', 'Corps de requête trop volumineux', request);
  // Reject early from the declared size; the streamed read below enforces the cap when it is absent or wrong.
  if (method === 'POST' && Number(request.headers.get('content-length')) > bodyLimit) return tooLarge();

  const headers = new Headers();
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }

  if (!rule.public) {
    try {
      headers.set('authorization', `Bearer ${await deps.getBackendToken()}`);
    } catch (error) {
      // Configuration or Backend problem on our side: keep the cause in server logs, never in the response.
      console.error('[backend-proxy] backend token unavailable:', (error as Error).message);
      return problem(503, 'UPSTREAM_UNAVAILABLE', 'Service momentanément indisponible', request, {
        'retry-after': '1',
      });
    }
  }

  let upstream: Response;
  try {
    const body = method === 'POST' ? await readCapped(request, bodyLimit) : undefined;
    if (body === null) return tooLarge();
    const url = new URL(pathname, deps.backendUrl);
    if (method === 'GET') {
      const incoming = new URL(request.url).searchParams;
      for (const name of FORWARDED_QUERY) {
        const value = incoming.get(name);
        if (value !== null) url.searchParams.set(name, value);
      }
    }
    upstream = await deps.fetch(url, { method, headers, body });
  } catch {
    return problem(503, 'UPSTREAM_UNAVAILABLE', 'Service momentanément indisponible', request, {
      'retry-after': '1',
    });
  }

  if (rule.download && upstream.ok && upstream.body) {
    // Streamed through, never buffered.
    const headers = new Headers();
    for (const name of DOWNLOAD_RESPONSE_HEADERS) {
      const value = upstream.headers.get(name);
      if (value !== null) headers.set(name, value);
    }
    headers.set('x-content-type-options', 'nosniff');
    headers.set('cache-control', 'private, no-store');
    return new Response(upstream.body, { status: upstream.status, headers });
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
