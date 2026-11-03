export type DatabaseConfig = { kind: 'postgres'; url: string; poolMax: number } | { kind: 'pglite'; dataDir?: string };

export interface OidcConfig {
  issuer: string;
  jwksUrl: URL;
  tokenUrl: URL;
  clientId: string;
  clientSecret: string;
}

export interface ToolingConfig {
  host: string;
  port: number;
  production: boolean;
  oidc: OidcConfig;
  backendUrl: URL;
  backendJwksUrl: URL;
  proofIssuer?: string;
  xroadUrl: URL;
  database: DatabaseConfig;
  mandateTtlMs: number;
  events: { publisher: boolean; intervalMs: number };
  tracking: { worker: boolean; intervalMs: number; pollMs: number };
  rateLimits: { perUser: number; perClient: number; authFailuresPerIp: number };
  trustProxy: string | false;
}

export const TOOLING_CONFIG = Symbol('TOOLING_CONFIG');
export const TOOLING_AUDIENCE = 'techma-tooling';
export const MANDATE_PROOF_AUDIENCE = 'techma-mandate';
export const BACKEND_CLIENT = 'backend';

const LOCAL_HOSTS = new Set(['127.0.0.1', '::1', '[::1]', 'localhost']);

export class ConfigError extends Error {}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) throw new ConfigError(`${name} requis`);
  return value;
}

function integer(env: NodeJS.ProcessEnv, name: string, fallback: number, min: number, max: number): number {
  const value = Number(env[name] ?? fallback);
  if (!Number.isInteger(value) || value < min || value > max) throw new ConfigError(`${name} doit être un entier entre ${min} et ${max}`);
  return value;
}

function onOff(env: NodeJS.ProcessEnv, name: string): boolean {
  const value = env[name] ?? 'on';
  if (value !== 'on' && value !== 'off') throw new ConfigError(`${name} doit valoir on ou off`);
  return value === 'on';
}

function serviceUrl(name: string, raw: string): URL {
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

function database(env: NodeJS.ProcessEnv, production: boolean): DatabaseConfig {
  const raw = required(env, 'DATABASE_URL');
  if (raw.startsWith('pglite:')) {
    if (production || env.NODE_ENV !== 'test') throw new ConfigError('PGlite est réservé aux tests (NODE_ENV=test)');
    const path = raw.slice('pglite:'.length);
    return path === 'memory' ? { kind: 'pglite' } : { kind: 'pglite', dataDir: path };
  }
  if (!/^postgres(ql)?:\/\//.test(raw)) throw new ConfigError('DATABASE_URL doit être postgres://…');
  return { kind: 'postgres', url: raw, poolMax: integer(env, 'DATABASE_POOL_MAX', 10, 1, 100) };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ToolingConfig {
  const production = env.NODE_ENV === 'production';
  const host = env.TOOLING_HOST ?? '127.0.0.1';
  const port = integer(env, 'TOOLING_PORT', 4030, 0, 65535);

  const issuer = serviceUrl('OIDC_ISSUER', required(env, 'OIDC_ISSUER')).href.replace(/\/$/, '');
  const oidc: OidcConfig = {
    issuer,
    jwksUrl: serviceUrl('OIDC_JWKS_URL', env.OIDC_JWKS_URL ?? `${issuer}/protocol/openid-connect/certs`),
    tokenUrl: serviceUrl('OIDC_TOKEN_URL', env.OIDC_TOKEN_URL ?? `${issuer}/protocol/openid-connect/token`),
    clientId: env.OIDC_CLIENT_ID ?? 'tooling',
    clientSecret: required(env, 'OIDC_CLIENT_SECRET'),
  };

  const backendUrl = serviceUrl('BACKEND_URL', required(env, 'BACKEND_URL'));
  const trustProxy = env.TRUST_PROXY ?? 'false';
  if (!/^(false|loopback|linklocal|uniquelocal)(\s*,\s*(loopback|linklocal|uniquelocal))*$/.test(trustProxy)) {
    throw new ConfigError('TRUST_PROXY doit valoir false ou une liste parmi loopback, linklocal, uniquelocal');
  }

  return {
    host,
    port,
    production,
    oidc,
    backendUrl,
    backendJwksUrl: serviceUrl('BACKEND_JWKS_URL', env.BACKEND_JWKS_URL ?? new URL('.well-known/jwks.json', backendUrl.href.replace(/\/?$/, '/')).href),
    ...(env.PROOF_ISSUER ? { proofIssuer: env.PROOF_ISSUER } : {}),
    xroadUrl: serviceUrl('XROAD_URL', required(env, 'XROAD_URL')),
    database: database(env, production),
    mandateTtlMs: 3_600_000,
    events: { publisher: onOff(env, 'EVENTS_PUBLISHER'), intervalMs: integer(env, 'EVENTS_INTERVAL_MS', 500, 20, 60_000) },
    tracking: {
      worker: onOff(env, 'TRACKING_WORKER'),
      intervalMs: integer(env, 'TRACKING_INTERVAL_MS', 1000, 20, 600_000),
      pollMs: integer(env, 'TRACKING_POLL_MS', 3000, 20, 86_400_000),
    },
    rateLimits: {
      perUser: integer(env, 'RATE_LIMIT_USER_PER_MIN', 60, 1, 100_000),
      perClient: integer(env, 'RATE_LIMIT_CLIENT_PER_MIN', 1200, 1, 1_000_000),
      authFailuresPerIp: integer(env, 'RATE_LIMIT_AUTH_FAILURES_PER_MIN', 20, 1, 10_000),
    },
    trustProxy: trustProxy === 'false' ? false : trustProxy,
  };
}
