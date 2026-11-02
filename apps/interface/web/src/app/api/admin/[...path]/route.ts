import { getAuthConfig } from '@/server/auth/config';
import { requireRole } from '@/server/auth/tokens';
import { proxyToAdmin } from '@/server/admin-proxy';

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
  const access = await requireRole('official');
  if (!access.ok) {
    return access.reason === 'unauthenticated'
      ? problem(401, 'UNAUTHORIZED', 'Connexion requise')
      : problem(403, 'FORBIDDEN', 'Accès réservé aux agents des administrations');
  }
  return proxyToAdmin(request, path, {
    backendUrl: getAuthConfig().backendUrl,
    getAdminToken: () => access.token,
    fetch,
  });
}

export const GET = handle;
export const PUT = handle;
export const POST = handle;
