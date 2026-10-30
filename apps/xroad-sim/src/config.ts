export type AuthMode = 'jwt' | 'mock-tokens';

export interface SimConfig {
  host: string;
  port: number;
  authMode: AuthMode;
  jwt?: { jwksUrl: URL; issuer: string };
  seedHistory: boolean;
  stateFile?: string;
}

export class ConfigError extends Error {}

export const XROAD_AUDIENCE = 'techma-xroad';
const LOCAL_HOSTS = new Set(['127.0.0.1', '::1', '[::1]', 'localhost']);

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) throw new ConfigError(`${name} requis`);
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): SimConfig {
  const production = env.NODE_ENV === 'production';
  const host = env.XROAD_HOST ?? '127.0.0.1';
  const port = Number(env.XROAD_PORT ?? 4040);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new ConfigError('XROAD_PORT invalide');

  const authMode = (env.AUTH_MODE ?? (production ? 'jwt' : 'mock-tokens')) as AuthMode;
  if (authMode !== 'jwt' && authMode !== 'mock-tokens') throw new ConfigError('AUTH_MODE doit valoir jwt ou mock-tokens');
  if (authMode === 'mock-tokens' && (production || !LOCAL_HOSTS.has(host))) {
    throw new ConfigError('AUTH_MODE=mock-tokens est réservé à une écoute locale hors production');
  }

  const seed = env.XROAD_SEED_HISTORY ?? 'on';
  if (seed !== 'on' && seed !== 'off') throw new ConfigError('XROAD_SEED_HISTORY doit valoir on ou off');

  const stateFile = env.XROAD_STATE_FILE || undefined;
  const base = { host, port, authMode, seedHistory: seed === 'on', ...(stateFile ? { stateFile } : {}) };
  if (authMode === 'mock-tokens') return base;

  const jwksUrl = new URL(required(env, 'JWT_JWKS_URL'));
  if (jwksUrl.protocol !== 'https:' && !(jwksUrl.protocol === 'http:' && LOCAL_HOSTS.has(jwksUrl.hostname))) {
    throw new ConfigError('JWT_JWKS_URL doit être en HTTPS hors localhost');
  }
  return { ...base, jwt: { jwksUrl, issuer: required(env, 'JWT_ISSUER') } };
}
