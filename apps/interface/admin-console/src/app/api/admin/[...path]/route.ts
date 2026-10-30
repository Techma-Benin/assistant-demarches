import { proxyToAdmin } from '@/server/admin-proxy';
import { getAdminToken } from '@/server/admin-token';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ path: string[] }> };

async function handle(request: Request, { params }: Context): Promise<Response> {
  const { path } = await params;
  return proxyToAdmin(request, path, {
    backendUrl: process.env.BACKEND_URL ?? 'http://127.0.0.1:4010',
    getAdminToken,
    fetch,
  });
}

export const GET = handle;
export const PUT = handle;
