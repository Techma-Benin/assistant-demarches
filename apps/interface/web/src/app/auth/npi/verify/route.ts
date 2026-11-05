import { decodeJwt } from 'jose';
import { attachGuest } from '@/server/auth/attach';
import { getAuthConfig } from '@/server/auth/config';
import { CONVERSATION_ID } from '@/server/auth/links';
import { NPI_CODE_PATTERN, npiLoginEnabled, verifyNpiCode } from '@/server/auth/npi';
import { readSession, writeSession, type Session, type UserSession } from '@/server/auth/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const json = (body: unknown, status: number) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });

/** Step 2 of the simulated NPI sign-in: the code opens a citizen session (12 h, never refreshed). */
export async function POST(request: Request): Promise<Response> {
  if (request.headers.get('origin') !== getAuthConfig().publicOrigin) return new Response(null, { status: 403 });
  if (!npiLoginEnabled()) return new Response(null, { status: 404 });
  let input: { code?: unknown; conversationId?: unknown } | null;
  try {
    input = (await request.json()) as typeof input;
  } catch {
    input = null;
  }
  const code = input?.code;
  if (typeof code !== 'string' || !NPI_CODE_PATTERN.test(code)) return json({ error: 'invalid' }, 400);
  const conversationId =
    typeof input?.conversationId === 'string' && CONVERSATION_ID.test(input.conversationId) ? input.conversationId : undefined;

  const session = await readSession();
  const challenge = session.npiChallenge;
  if (!challenge || Date.parse(challenge.expiresAt) <= Date.now()) {
    if (challenge) await writeSession({ ...session, npiChallenge: undefined });
    return json({ error: 'expired' }, 401);
  }

  const result = await verifyNpiCode(challenge.token, code);
  if (!result.ok) return json({ error: 'failed' }, result.status);

  const { token, expiresAt } = result.body;
  const expires = Date.parse(expiresAt);
  let sub: string | undefined;
  try {
    sub = decodeJwt(token).sub;
  } catch {
    sub = undefined;
  }
  if (!sub || !Number.isFinite(expires)) return json({ error: 'failed' }, 503);
  const user: UserSession = {
    accessToken: token,
    refreshToken: '',
    accessExpiresAt: expires,
    refreshExpiresAt: expires,
    sub,
    name: 'Usager',
    roles: ['citizen'],
    provider: 'npi',
  };

  const next: Session = { ...session, user };
  delete next.npiChallenge;
  let attachFailed = false;
  if (session.guest && conversationId && Date.parse(session.guest.expiresAt) > Date.now()) {
    if (await attachGuest(conversationId, session.guest.token, token)) delete next.guest;
    else attachFailed = true;
  }
  await writeSession(next);
  return json({ attachFailed }, 200);
}
