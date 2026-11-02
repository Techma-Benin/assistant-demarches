import { getAuthConfig } from '@/server/auth/config';
import { getBackendToken } from '@/server/auth/tokens';
import { proxyToBackend } from '@/server/backend-proxy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ path: string[] }> };

async function handle(request: Request, { params }: Context): Promise<Response> {
  const { path } = await params;
  return proxyToBackend(request, path, {
    backendUrl: getAuthConfig().backendUrl,
    getBackendToken,
    fetch,
  });
}

export const GET = handle;
export const POST = handle;
