import { proxyToBackend } from '@/server/backend-proxy';
import { getUserToken } from '@/server/user-token';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ path: string[] }> };

async function handle(request: Request, { params }: Context): Promise<Response> {
  const { path } = await params;
  return proxyToBackend(request, path, {
    backendUrl: process.env.BACKEND_URL ?? 'http://127.0.0.1:4010',
    getUserToken,
    fetch,
  });
}

export const GET = handle;
export const POST = handle;
