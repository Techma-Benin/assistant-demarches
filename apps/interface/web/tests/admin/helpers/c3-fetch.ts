import { vi } from 'vitest';

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export const problem = (status: number, code: string, detail: string) =>
  new Response(JSON.stringify({ status, code, detail, title: code }), {
    status,
    headers: { 'content-type': 'application/problem+json' },
  });

export interface PutCall {
  url: string;
  key: string | null;
  body: any;
}

/**
 * Stubs global fetch: GET lists are served from `lists` (one page, or `pages` to test the cursor),
 * PUTs are recorded in `puts` and answered by `onPut` (default: echo the body).
 */
export function stubC3(options: {
  lists: Record<string, unknown[][]>;
  onPut?: (call: PutCall, attempt: number) => Response | Promise<Response>;
}) {
  const puts: PutCall[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://console.local');
    if (init?.method === 'PUT') {
      const headers = init.headers as Record<string, string>;
      const call = { url: url.pathname, key: headers['idempotency-key'] ?? null, body: JSON.parse(String(init.body)) };
      puts.push(call);
      return options.onPut ? options.onPut(call, puts.length) : json(call.body);
    }
    const resource = url.pathname.split('/').pop()!;
    const pages = options.lists[resource] ?? [[]];
    const index = Number(url.searchParams.get('cursor') ?? 0);
    return json({ items: pages[index], nextCursor: index + 1 < pages.length ? String(index + 1) : null });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { puts, fetchMock };
}
