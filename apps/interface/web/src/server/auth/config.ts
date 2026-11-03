import { readFileSync } from 'node:fs';

export interface AuthConfig {
  publicUrl: string;
  /** Origin of PUBLIC_URL, for same-origin checks. */
  publicOrigin: string;
  backendUrl: string;
  issuer: string;
  clientId: string;
  clientSecret: string;
  /** 32-byte AES-256-GCM key for the session cookies. */
  sessionKey: Uint8Array;
  /** `Secure` cookies only when the public URL is https. */
  secureCookies: boolean;
}

const REQUIRED = ['PUBLIC_URL', 'BACKEND_URL', 'OIDC_ISSUER', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET', 'SESSION_SECRET_FILE'] as const;

let cached: AuthConfig | null = null;

function parseUrl(name: string, value: string): URL {
  try {
    return new URL(value);
  } catch {
    throw new Error(`Variable d’environnement ${name} invalide : URL attendue`);
  }
}

/** Reads and validates the auth environment once. Errors name the variable, never its value. */
export function getAuthConfig(): AuthConfig {
  if (cached) return cached;
  const env = process.env;
  for (const name of REQUIRED) {
    if (!env[name]) throw new Error(`Variable d’environnement ${name} manquante`);
  }
  const publicUrl = parseUrl('PUBLIC_URL', env.PUBLIC_URL!);
  const backendUrl = parseUrl('BACKEND_URL', env.BACKEND_URL!);
  parseUrl('OIDC_ISSUER', env.OIDC_ISSUER!);

  let sessionKey: Uint8Array;
  try {
    sessionKey = new Uint8Array(Buffer.from(readFileSync(env.SESSION_SECRET_FILE!, 'utf8').trim(), 'base64url'));
  } catch {
    throw new Error('SESSION_SECRET_FILE illisible');
  }
  if (sessionKey.length !== 32) throw new Error('SESSION_SECRET_FILE doit contenir 32 octets encodés en base64url');

  cached = {
    publicUrl: publicUrl.origin,
    publicOrigin: publicUrl.origin,
    backendUrl: backendUrl.origin,
    issuer: env.OIDC_ISSUER!,
    clientId: env.OIDC_CLIENT_ID!,
    clientSecret: env.OIDC_CLIENT_SECRET!,
    sessionKey,
    secureCookies: publicUrl.protocol === 'https:',
  };
  return cached;
}

export function resetAuthConfigForTests(): void {
  cached = null;
}
