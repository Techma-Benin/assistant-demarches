import { CompactEncrypt, compactDecrypt } from 'jose';
import { cookies } from 'next/headers';
import { getAuthConfig } from './config';

export const SESSION_COOKIE = 'ad_session';
export const AUTH_COOKIE = 'ad_auth';
/** Max size of one cookie value before the session is split (a browser cookie caps at ~4096 bytes with its attributes). */
export const MAX_COOKIE_VALUE = 3800;
const SESSION_MAX_AGE = 60 * 60 * 24 * 30;
const AUTH_MAX_AGE = 600;

export interface GuestSession {
  token: string;
  /** ISO date-time returned by the Backend. */
  expiresAt: string;
}

export interface UserSession {
  accessToken: string;
  refreshToken: string;
  /** Sent as id_token_hint at logout so Keycloak skips its confirmation page; absent on sessions created before it was stored. */
  idToken?: string;
  /** Epoch milliseconds. */
  accessExpiresAt: number;
  refreshExpiresAt: number;
  sub: string;
  name: string;
  roles: string[];
  /** Set for the simulated NPI sign-in: no refresh token, never refreshed. */
  provider?: 'npi';
}

/** Pending NPI challenge; stays in the encrypted cookie, never sent to the browser. */
export interface NpiChallenge {
  token: string;
  /** ISO date-time returned by the Backend. */
  expiresAt: string;
}

export interface Session {
  guest?: GuestSession;
  user?: UserSession;
  npiChallenge?: NpiChallenge;
}

export interface AuthTransaction {
  state: string;
  codeVerifier: string;
  nonce: string;
  returnTo: string;
  attachConversationId?: string;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export async function seal(payload: unknown): Promise<string> {
  const { sessionKey } = getAuthConfig();
  return new CompactEncrypt(encoder.encode(JSON.stringify(payload)))
    .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
    .encrypt(sessionKey);
}

/** Decrypts and parses; null when tampered, truncated or not an object. */
export async function unseal(value: string): Promise<Record<string, unknown> | null> {
  try {
    const { sessionKey } = getAuthConfig();
    const { plaintext } = await compactDecrypt(value, sessionKey, {
      keyManagementAlgorithms: ['dir'],
      contentEncryptionAlgorithms: ['A256GCM'],
    });
    const parsed: unknown = JSON.parse(decoder.decode(plaintext));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    path: '/',
    secure: getAuthConfig().secureCookies,
    maxAge,
  };
}

const chunkName = (index: number) => `${SESSION_COOKIE}.${index}`;
const isSessionCookie = (name: string) =>
  name === SESSION_COOKIE || new RegExp(`^${SESSION_COOKIE.replace('.', '\\.')}\\.\\d+$`).test(name);

type CookieStore = Awaited<ReturnType<typeof cookies>>;

function readRawSession(store: CookieStore): string | null {
  const single = store.get(SESSION_COOKIE)?.value;
  if (single) return single;
  let joined = '';
  for (let index = 0; ; index++) {
    const part = store.get(chunkName(index))?.value;
    if (part === undefined) break;
    joined += part;
  }
  return joined || null;
}

const isString = (value: unknown): value is string => typeof value === 'string';
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

function toSession(data: Record<string, unknown>): Session {
  const session: Session = {};
  const guest = data.guest as Partial<GuestSession> | undefined;
  if (guest && isString(guest.token) && isString(guest.expiresAt)) {
    session.guest = { token: guest.token, expiresAt: guest.expiresAt };
  }
  const user = data.user as Partial<UserSession> | undefined;
  if (
    user &&
    isString(user.accessToken) &&
    isString(user.refreshToken) &&
    isNumber(user.accessExpiresAt) &&
    isNumber(user.refreshExpiresAt) &&
    isString(user.sub) &&
    isString(user.name) &&
    Array.isArray(user.roles)
  ) {
    session.user = {
      accessToken: user.accessToken,
      refreshToken: user.refreshToken,
      ...(isString(user.idToken) ? { idToken: user.idToken } : {}),
      accessExpiresAt: user.accessExpiresAt,
      refreshExpiresAt: user.refreshExpiresAt,
      sub: user.sub,
      name: user.name,
      roles: user.roles.filter(isString),
      ...(user.provider === 'npi' ? { provider: 'npi' as const } : {}),
    };
  }
  const challenge = data.npiChallenge as Partial<NpiChallenge> | undefined;
  if (challenge && isString(challenge.token) && isString(challenge.expiresAt)) {
    session.npiChallenge = { token: challenge.token, expiresAt: challenge.expiresAt };
  }
  return session;
}

/** Current session; empty when the cookie is absent, tampered or undecryptable. */
export async function readSession(): Promise<Session> {
  const raw = readRawSession(await cookies());
  if (!raw) return {};
  const data = await unseal(raw);
  return data ? toSession(data) : {};
}

function deleteSessionCookies(store: CookieStore, keep: ReadonlySet<string> = new Set()) {
  for (const { name } of store.getAll()) {
    if (isSessionCookie(name) && !keep.has(name)) store.delete(name);
  }
}

/** Route handlers and Server Functions only (cookies cannot be set while rendering). */
export async function writeSession(session: Session): Promise<void> {
  const store = await cookies();
  if (!session.guest && !session.user && !session.npiChallenge) {
    deleteSessionCookies(store);
    return;
  }
  const value = await seal(session);
  const options = cookieOptions(SESSION_MAX_AGE);
  const written = new Set<string>();
  if (value.length <= MAX_COOKIE_VALUE) {
    store.set(SESSION_COOKIE, value, options);
    written.add(SESSION_COOKIE);
  } else {
    for (let index = 0; index * MAX_COOKIE_VALUE < value.length; index++) {
      const name = chunkName(index);
      store.set(name, value.slice(index * MAX_COOKIE_VALUE, (index + 1) * MAX_COOKIE_VALUE), options);
      written.add(name);
    }
  }
  deleteSessionCookies(store, written);
}

export async function clearSession(): Promise<void> {
  deleteSessionCookies(await cookies());
}

export async function writeTransaction(transaction: AuthTransaction): Promise<void> {
  (await cookies()).set(AUTH_COOKIE, await seal(transaction), cookieOptions(AUTH_MAX_AGE));
}

/** Reads then deletes the login transaction; null when absent or invalid. */
export async function takeTransaction(): Promise<AuthTransaction | null> {
  const store = await cookies();
  const raw = store.get(AUTH_COOKIE)?.value;
  if (raw === undefined) return null;
  store.delete(AUTH_COOKIE);
  const data = await unseal(raw);
  if (!data || !isString(data.state) || !isString(data.codeVerifier) || !isString(data.nonce) || !isString(data.returnTo)) {
    return null;
  }
  return {
    state: data.state,
    codeVerifier: data.codeVerifier,
    nonce: data.nonce,
    returnTo: data.returnTo,
    ...(isString(data.attachConversationId) ? { attachConversationId: data.attachConversationId } : {}),
  };
}
