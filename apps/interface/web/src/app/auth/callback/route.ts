import { getAuthConfig } from '@/server/auth/config';
import { redirectToApp } from '@/server/auth/links';
import { completeLogin } from '@/server/auth/oidc';
import { readSession, takeTransaction, writeSession, type Session } from '@/server/auth/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const failed = () => redirectToApp('/', 302, { auth: 'failed' });

/** Moves the guest's conversations to the account. True when the Backend accepted (the guest token can go). */
async function attachGuest(conversationId: string, guestToken: string, userToken: string): Promise<boolean> {
  try {
    const response = await fetch(new URL(`/v1/conversations/${conversationId}/attach`, getAuthConfig().backendUrl), {
      method: 'POST',
      headers: { authorization: `Bearer ${userToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ guestToken }),
    });
    return response.status === 200;
  } catch {
    return false;
  }
}

export async function GET(request: Request): Promise<Response> {
  const { publicUrl } = getAuthConfig();
  const incoming = new URL(request.url);
  const transaction = await takeTransaction();
  // Never echo provider error text: any `error` is reduced to auth=failed.
  if (!transaction || incoming.searchParams.has('error') || incoming.searchParams.get('state') !== transaction.state) {
    return failed();
  }

  let user;
  try {
    user = await completeLogin(new URL(`/auth/callback${incoming.search}`, publicUrl), transaction);
  } catch (error) {
    console.error('[auth] callback failed:', (error as Error).message);
    return failed();
  }

  const session: Session = await readSession();
  const next: Session = { ...session, user };
  let attachFailed = false;
  if (session.guest && transaction.attachConversationId && Date.parse(session.guest.expiresAt) > Date.now()) {
    if (await attachGuest(transaction.attachConversationId, session.guest.token, user.accessToken)) delete next.guest;
    else attachFailed = true;
  }
  await writeSession(next);
  return redirectToApp(transaction.returnTo, 302, attachFailed ? { attach: 'failed' } : undefined);
}
