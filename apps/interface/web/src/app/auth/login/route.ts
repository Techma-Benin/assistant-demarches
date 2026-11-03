import { getAuthConfig } from '@/server/auth/config';
import { CONVERSATION_ID, redirectToApp, safeReturnTo } from '@/server/auth/links';
import { buildLogin } from '@/server/auth/oidc';
import { writeTransaction } from '@/server/auth/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  // Keycloak returns to PUBLIC_URL: start the login on that host, or the transaction cookie is set on another one
  // (localhost and 127.0.0.1 are different cookie hosts).
  const host = request.headers.get('host');
  if (host && host !== new URL(getAuthConfig().publicUrl).host) {
    return redirectToApp(`/auth/login?${params.toString()}`);
  }
  const returnTo = safeReturnTo(params.get('returnTo'));
  const conversationId = params.get('conversationId');
  try {
    const { url, transaction } = await buildLogin(
      returnTo,
      conversationId && CONVERSATION_ID.test(conversationId) ? conversationId : undefined,
    );
    await writeTransaction(transaction);
    return new Response(null, { status: 302, headers: { location: url.toString(), 'cache-control': 'no-store' } });
  } catch (error) {
    console.error('[auth] login failed:', (error as Error).message);
    return redirectToApp('/', 302, { auth: 'failed' });
  }
}
