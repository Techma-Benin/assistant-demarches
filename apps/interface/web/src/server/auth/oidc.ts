import { decodeJwt } from 'jose';
import * as client from 'openid-client';
import { getAuthConfig } from './config';
import type { AuthTransaction, UserSession } from './session';

const SCOPE = 'openid profile';
const DEFAULT_REFRESH_LIFETIME_MS = 30 * 60 * 1000;

let configuration: Promise<client.Configuration> | null = null;

/** Discovery is fetched once and reused; a failure is not cached. */
export function getOidcConfiguration(): Promise<client.Configuration> {
  if (!configuration) {
    const { issuer, clientId, clientSecret } = getAuthConfig();
    const insecure = new URL(issuer).protocol === 'http:';
    configuration = client
      .discovery(new URL(issuer), clientId, clientSecret, undefined, insecure ? { execute: [client.allowInsecureRequests] } : undefined)
      .catch((error: unknown) => {
        configuration = null;
        throw error;
      });
  }
  return configuration;
}

export function resetOidcForTests(): void {
  configuration = null;
}

export const redirectUri = () => `${getAuthConfig().publicUrl}/auth/callback`;

export async function buildLogin(
  returnTo: string,
  attachConversationId?: string,
): Promise<{ url: URL; transaction: AuthTransaction }> {
  const config = await getOidcConfiguration();
  const codeVerifier = client.randomPKCECodeVerifier();
  const state = client.randomState();
  const nonce = client.randomNonce();
  const url = client.buildAuthorizationUrl(config, {
    redirect_uri: redirectUri(),
    scope: SCOPE,
    code_challenge: await client.calculatePKCECodeChallenge(codeVerifier),
    code_challenge_method: 'S256',
    state,
    nonce,
  });
  return { url, transaction: { state, codeVerifier, nonce, returnTo, ...(attachConversationId ? { attachConversationId } : {}) } };
}

type TokenResponse = Awaited<ReturnType<typeof client.refreshTokenGrant>>;

function realmRoles(accessToken: string): string[] {
  try {
    const roles = (decodeJwt(accessToken) as { realm_access?: { roles?: unknown } }).realm_access?.roles;
    return Array.isArray(roles) ? roles.filter((role): role is string => typeof role === 'string') : [];
  } catch {
    return [];
  }
}

function refreshExpiry(tokens: TokenResponse, refreshToken: string, now: number): number {
  const lifetime = Number(tokens.refresh_expires_in);
  if (Number.isFinite(lifetime) && lifetime > 0) return now + lifetime * 1000;
  try {
    const { exp } = decodeJwt(refreshToken);
    if (typeof exp === 'number') return exp * 1000;
  } catch {
    // Opaque refresh token: fall through.
  }
  return now + DEFAULT_REFRESH_LIFETIME_MS;
}

function toUser(tokens: TokenResponse, identity: { sub: string; name: string }, fallbackRefresh?: string, fallbackIdToken?: string): UserSession {
  const now = Date.now();
  const refreshToken = tokens.refresh_token ?? fallbackRefresh;
  if (!refreshToken) throw new Error('Réponse de jetons sans refresh_token');
  const idToken = tokens.id_token ?? fallbackIdToken;
  return {
    accessToken: tokens.access_token,
    refreshToken,
    ...(idToken ? { idToken } : {}),
    accessExpiresAt: now + (tokens.expires_in ?? 60) * 1000,
    refreshExpiresAt: refreshExpiry(tokens, refreshToken, now),
    sub: identity.sub,
    name: identity.name,
    roles: realmRoles(tokens.access_token),
  };
}

/** Exchanges the code; validates state, nonce, PKCE and the id_token. The id_token is kept for the logout hint. */
export async function completeLogin(callbackUrl: URL, transaction: AuthTransaction): Promise<UserSession> {
  const config = await getOidcConfiguration();
  const tokens = await client.authorizationCodeGrant(config, callbackUrl, {
    pkceCodeVerifier: transaction.codeVerifier,
    expectedState: transaction.state,
    expectedNonce: transaction.nonce,
    idTokenExpected: true,
  });
  const claims = tokens.claims();
  if (!claims) throw new Error('id_token absent');
  const name = [claims.name, claims.preferred_username].find((value): value is string => typeof value === 'string' && value !== '');
  return toUser(tokens, { sub: claims.sub, name: name ?? claims.sub });
}

/** Refresh grant; keeps identity, re-reads roles and rotates the refresh token. */
export async function refreshUser(user: UserSession): Promise<UserSession> {
  const config = await getOidcConfiguration();
  const tokens = await client.refreshTokenGrant(config, user.refreshToken);
  return toUser(tokens, { sub: user.sub, name: user.name }, user.refreshToken, user.idToken);
}

/** Keycloak end-session URL, or null when the provider does not advertise one. */
export async function buildLogoutUrl(idToken?: string): Promise<URL | null> {
  const { publicUrl } = getAuthConfig();
  try {
    const config = await getOidcConfiguration();
    return client.buildEndSessionUrl(config, {
      post_logout_redirect_uri: `${publicUrl}/`,
      ...(idToken ? { id_token_hint: idToken } : {}),
    });
  } catch {
    return null;
  }
}
