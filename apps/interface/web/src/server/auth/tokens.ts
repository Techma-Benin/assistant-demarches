import { getAuthConfig } from './config';
import { refreshUser } from './oidc';
import { readSession, writeSession, type GuestSession, type UserSession } from './session';

const REFRESH_MARGIN_MS = 30_000;
const GUEST_MARGIN_MS = 5 * 60_000;

export type RoleFailure = 'unauthenticated' | 'forbidden';
export type RoleResult = { ok: true; token: string; user: UserSession } | { ok: false; reason: RoleFailure };

// A rotating refresh token is single-use: concurrent requests of one browser must share one refresh.
const refreshing = new Map<string, Promise<UserSession>>();

function refreshOnce(user: UserSession): Promise<UserSession> {
  let pending = refreshing.get(user.refreshToken);
  if (!pending) {
    pending = refreshUser(user).finally(() => refreshing.delete(user.refreshToken));
    refreshing.set(user.refreshToken, pending);
  }
  return pending;
}

/** Valid user session (refreshed when the access token expires within 30 s), or null. Route handlers only. */
async function currentUser(): Promise<UserSession | null> {
  const session = await readSession();
  const user = session.user;
  if (!user) return null;
  const now = Date.now();
  if (user.accessExpiresAt - now > REFRESH_MARGIN_MS) return user;
  if (user.provider === 'npi') {
    // No refresh token: close to expiry the user is signed out.
    await writeSession({ ...session, user: undefined });
    return null;
  }
  if (user.refreshExpiresAt <= now) {
    await writeSession({ ...session, user: undefined });
    return null;
  }
  try {
    const refreshed = await refreshOnce(user);
    await writeSession({ ...session, user: refreshed });
    return refreshed;
  } catch {
    await writeSession({ ...session, user: undefined });
    return null;
  }
}

export async function getUserAccessToken(): Promise<string | null> {
  return (await currentUser())?.accessToken ?? null;
}

async function createGuest(): Promise<GuestSession> {
  const response = await fetch(new URL('/v1/guest-sessions', getAuthConfig().backendUrl), { method: 'POST' });
  if (response.status !== 201) throw new Error(`guest-sessions: HTTP ${response.status}`);
  const body = (await response.json()) as Partial<GuestSession>;
  if (typeof body.token !== 'string' || typeof body.expiresAt !== 'string') throw new Error('guest-sessions: réponse invalide');
  return { token: body.token, expiresAt: body.expiresAt };
}

/** User token when logged in, else the guest token (created when missing or expiring within 5 min). Throws if no guest can be created. */
export async function getBackendToken(): Promise<string> {
  const userToken = await getUserAccessToken();
  if (userToken) return userToken;
  const session = await readSession();
  const guest = session.guest;
  if (guest && Date.parse(guest.expiresAt) - Date.now() > GUEST_MARGIN_MS) return guest.token;
  const created = await createGuest();
  await writeSession({ ...session, guest: created });
  return created.token;
}

export async function requireRole(role: string): Promise<RoleResult> {
  const user = await currentUser();
  if (!user) return { ok: false, reason: 'unauthenticated' };
  if (!user.roles.includes(role)) return { ok: false, reason: 'forbidden' };
  return { ok: true, token: user.accessToken, user };
}
