import { getAuthConfig } from '@/server/auth/config';
import { requireRole } from '@/server/auth/tokens';
import { proxyToOperator } from '@/server/operator-proxy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ path: string[] }> };

function problem(status: 401 | 403, code: 'UNAUTHORIZED' | 'FORBIDDEN', detail: string): Response {
  return new Response(
    JSON.stringify({ type: 'about:blank', title: code, status, detail, code, traceId: '0'.repeat(32) }),
    { status, headers: { 'content-type': 'application/problem+json', 'cache-control': 'no-store' } },
  );
}

async function handle(request: Request, { params }: Context): Promise<Response> {
  const { path } = await params;
  const access = await requireRole('operator');
  if (!access.ok) {
    return access.reason === 'unauthenticated'
      ? problem(401, 'UNAUTHORIZED', 'Connexion requise')
      : problem(403, 'FORBIDDEN', 'Accès réservé à l’opérateur');
  }
  return proxyToOperator(request, path, { backendUrl: getAuthConfig().backendUrl, token: access.token, fetch });
}

export const GET = handle;
export const PUT = handle;
export const POST = handle;
export const DELETE = handle;
