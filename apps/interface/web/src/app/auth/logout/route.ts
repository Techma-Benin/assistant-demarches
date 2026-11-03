import { getAuthConfig } from '@/server/auth/config';
import { redirectToApp } from '@/server/auth/links';
import { buildLogoutUrl } from '@/server/auth/oidc';
import { clearSession, readSession } from '@/server/auth/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  const origin = request.headers.get('origin');
  if (origin !== getAuthConfig().publicOrigin) return new Response(null, { status: 403 });
  const { user } = await readSession();
  await clearSession();
  const endSession = await buildLogoutUrl(user?.idToken);
  if (!endSession) return redirectToApp('/', 303);
  return new Response(null, { status: 303, headers: { location: endSession.toString(), 'cache-control': 'no-store' } });
}
