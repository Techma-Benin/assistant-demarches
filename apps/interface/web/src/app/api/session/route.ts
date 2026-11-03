import { readSession } from '@/server/auth/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Who is logged in, never a token. */
export async function GET(): Promise<Response> {
  const { user } = await readSession();
  const active = user && user.refreshExpiresAt > Date.now() ? { name: user.name, roles: user.roles } : null;
  return Response.json({ user: active }, { headers: { 'cache-control': 'no-store' } });
}
