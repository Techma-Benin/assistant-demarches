import { getAuthConfig } from '@/server/auth/config';
import { NPI_PATTERN, npiLoginEnabled, startNpiChallenge } from '@/server/auth/npi';
import { readSession, writeSession } from '@/server/auth/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const json = (body: unknown, status: number) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });

/** Step 1 of the simulated NPI sign-in: the challenge token stays in the encrypted session, never in the answer. */
export async function POST(request: Request): Promise<Response> {
  if (request.headers.get('origin') !== getAuthConfig().publicOrigin) return new Response(null, { status: 403 });
  if (!npiLoginEnabled()) return new Response(null, { status: 404 });
  let npi: unknown;
  try {
    npi = ((await request.json()) as { npi?: unknown } | null)?.npi;
  } catch {
    npi = undefined;
  }
  if (typeof npi !== 'string' || !NPI_PATTERN.test(npi)) return json({ error: 'invalid' }, 400);

  const result = await startNpiChallenge(npi);
  if (!result.ok) return json({ error: 'failed' }, result.status);
  await writeSession({ ...(await readSession()), npiChallenge: { token: result.body.challengeToken, expiresAt: result.body.expiresAt } });
  return json({ expiresAt: result.body.expiresAt, simulated: result.body.simulated }, 200);
}
