export type AuthMode = 'jwt' | 'mock-tokens';
export type OutboundClient = 'tooling-resources';

export interface OidcClient {
  id: string;
  secret: string;
  scope: string;
}

export interface JwtConfig {
  issuer: string;
  jwksUrl: URL;
  tokenUrl: URL;
  clients: Record<OutboundClient, OidcClient>;
}

export interface ToolingConfig {
  host: string;
  port: number;
  production: boolean;
  authMode: AuthMode;
  backendUrl: URL;
  /** Présent seulement en mode jwt. */
  jwt?: JwtConfig;
}

export const TOOLING_CONFIG = Symbol('TOOLING_CONFIG');
export const TOOLING_AUDIENCE = 'techma-tooling';

const LOCAL_HOSTS = new Set(['127.0.0.1', '::1', '[::1]', 'localhost']);

export class ConfigError extends Error {}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) throw new ConfigError(`${name} requis`);
  return value;
}

/** HTTPS obligatoire hors localhost. */
function serviceUrl(env: NodeJS.ProcessEnv, name: string, fallback?: string): URL {
  const raw = env[name] ?? fallback;
  if (!raw) throw new ConfigError(`${name} requis`);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ConfigError(`${name} n'est pas une URL`);
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname))) {
    throw new ConfigError(`${name} doit utiliser HTTPS hors localhost`);
  }
  return url;
}

/** Lit et valide l'environnement. Toute incohérence empêche le démarrage. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ToolingConfig {
  const production = env.NODE_ENV === 'production';
  const host = env.TOOLING_HOST ?? '127.0.0.1';
  const port = Number(env.TOOLING_PORT ?? 4030);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new ConfigError('TOOLING_PORT invalide');

  const authMode = (env.AUTH_MODE ?? 'jwt') as AuthMode;
  if (authMode !== 'jwt' && authMode !== 'mock-tokens') throw new ConfigError('AUTH_MODE doit valoir jwt ou mock-tokens');
  if (authMode === 'mock-tokens' && (production || !LOCAL_HOSTS.has(host))) {
    throw new ConfigError('AUTH_MODE=mock-tokens est réservé à une écoute locale hors production');
  }

  const backendUrl = serviceUrl(env, 'BACKEND_URL', production ? undefined : 'http://127.0.0.1:4010');
  if (authMode === 'mock-tokens') return { host, port, production, authMode, backendUrl };

  return {
    host,
    port,
    production,
    authMode,
    backendUrl,
    jwt: {
      issuer: required(env, 'JWT_ISSUER'),
      jwksUrl: serviceUrl(env, 'JWKS_URL'),
      tokenUrl: serviceUrl(env, 'OIDC_TOKEN_URL'),
      clients: {
        'tooling-resources': {
          id: required(env, 'TOOLING_RESOURCES_CLIENT_ID'),
          secret: required(env, 'TOOLING_RESOURCES_CLIENT_SECRET'),
          scope: 'resources:read',
        },
      },
    },
  };
}
