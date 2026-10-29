export type AuthMode = 'jwt' | 'mock-tokens';
export type OutboundClient = 'tooling-resources' | 'tooling-events';

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
  proof: { jwksUrl: URL; issuer?: string };
}

export type DatabaseConfig = { kind: 'postgres'; url: string; poolMax: number } | { kind: 'pglite'; dataDir?: string };

export interface ToolingConfig {
  host: string;
  port: number;
  production: boolean;
  authMode: AuthMode;
  backendUrl: URL;
  database: DatabaseConfig;
  workers: number;
  mandateTtlMs: number;
  allowDraftProcedures: boolean;
  events: { publisher: boolean; intervalMs: number };
  rateLimits: { perUser: number; perClient: number; authFailuresPerIp: number };
  trustProxy: string | false;
  connectors: { enabled: string[]; worker: boolean; intervalMs: number; pollMs: number; simulatedStepMs: number };
  jwt?: JwtConfig;
}

export const TOOLING_CONFIG = Symbol('TOOLING_CONFIG');
export const TOOLING_AUDIENCE = 'techma-tooling';
export const MANDATE_PROOF_AUDIENCE = 'techma-mandate';

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

function database(env: NodeJS.ProcessEnv, production: boolean): DatabaseConfig {
  const raw = env.DATABASE_URL ?? (production ? undefined : 'pglite:memory');
  if (!raw) throw new ConfigError('DATABASE_URL requis en production');
  if (raw.startsWith('pglite:')) {
    if (production) throw new ConfigError('PGlite est réservé aux tests et au poste local');
    const path = raw.slice('pglite:'.length);
    return path === 'memory' ? { kind: 'pglite' } : { kind: 'pglite', dataDir: path };
  }
  if (!/^postgres(ql)?:\/\//.test(raw)) throw new ConfigError('DATABASE_URL doit être postgres://… ou pglite:…');
  return { kind: 'postgres', url: raw, poolMax: integer(env, 'DATABASE_POOL_MAX', 10, 1, 100) };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ToolingConfig {
  const production = env.NODE_ENV === 'production';
  const host = env.TOOLING_HOST ?? '127.0.0.1';
  const port = integer(env, 'TOOLING_PORT', 4030, 0, 65535);

  const authMode = (env.AUTH_MODE ?? 'jwt') as AuthMode;
  if (authMode !== 'jwt' && authMode !== 'mock-tokens') throw new ConfigError('AUTH_MODE doit valoir jwt ou mock-tokens');
  if (authMode === 'mock-tokens' && (production || !LOCAL_HOSTS.has(host))) {
    throw new ConfigError('AUTH_MODE=mock-tokens est réservé à une écoute locale hors production');
  }

  const backendUrl = serviceUrl(env, 'BACKEND_URL', production ? undefined : 'http://127.0.0.1:4010');
  const db = database(env, production);
  const workers = integer(env, 'TOOLING_WORKERS', db.kind === 'pglite' ? 1 : 2, 1, 32);
  if (db.kind === 'pglite' && workers !== 1) throw new ConfigError('PGlite ne se partage pas : TOOLING_WORKERS doit valoir 1');

  const publisher = (env.EVENTS_PUBLISHER ?? 'on') as string;
  if (publisher !== 'on' && publisher !== 'off') throw new ConfigError('EVENTS_PUBLISHER doit valoir on ou off');

  const drafts = env.PROCEDURES_ALLOW_DRAFTS ?? (!production && LOCAL_HOSTS.has(host) ? 'true' : 'false');
  if (drafts !== 'true' && drafts !== 'false') throw new ConfigError('PROCEDURES_ALLOW_DRAFTS doit valoir true ou false');
  if (production && drafts === 'true') throw new ConfigError('Fiches en brouillon interdites en production');

  const trustProxy = env.TRUST_PROXY ?? 'false';
  if (!/^(false|loopback|linklocal|uniquelocal)(\s*,\s*(loopback|linklocal|uniquelocal))*$/.test(trustProxy)) {
    throw new ConfigError('TRUST_PROXY doit valoir false ou une liste parmi loopback, linklocal, uniquelocal');
  }

  const enabledConnectors = (env.CONNECTORS ?? '').split(',').map((name) => name.trim()).filter(Boolean);
  for (const name of enabledConnectors) {
    if (name !== 'simulated') throw new ConfigError(`Connecteur inconnu : ${name}`);
    if (production || !LOCAL_HOSTS.has(host)) throw new ConfigError('Le connecteur simulé est réservé au poste local hors production');
  }
  const connectorWorker = env.CONNECTOR_WORKER ?? 'on';
  if (connectorWorker !== 'on' && connectorWorker !== 'off') throw new ConfigError('CONNECTOR_WORKER doit valoir on ou off');

  const base = {
    host,
    port,
    production,
    authMode,
    backendUrl,
    database: db,
    workers,
    mandateTtlMs: 3_600_000,
    allowDraftProcedures: drafts === 'true',
    events: { publisher: publisher === 'on', intervalMs: integer(env, 'EVENTS_INTERVAL_MS', 1000, 50, 60_000) },
    rateLimits: {
      perUser: integer(env, 'RATE_LIMIT_USER_PER_MIN', 60, 1, 100_000),
      perClient: integer(env, 'RATE_LIMIT_CLIENT_PER_MIN', 1200, 1, 1_000_000),
      authFailuresPerIp: integer(env, 'RATE_LIMIT_AUTH_FAILURES_PER_MIN', 20, 1, 10_000),
    },
    trustProxy: trustProxy === 'false' ? (false as const) : trustProxy,
    connectors: {
      enabled: enabledConnectors,
      worker: connectorWorker === 'on',
      intervalMs: integer(env, 'CONNECTOR_INTERVAL_MS', 2000, 20, 600_000),
      pollMs: integer(env, 'CONNECTOR_POLL_MS', 300_000, 20, 86_400_000),
      simulatedStepMs: integer(env, 'CONNECTOR_SIMULATED_STEP_MS', 30_000, 0, 3_600_000),
    },
  };
  if (authMode === 'mock-tokens') return base;

  return {
    ...base,
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
        'tooling-events': {
          id: required(env, 'TOOLING_EVENTS_CLIENT_ID'),
          secret: required(env, 'TOOLING_EVENTS_CLIENT_SECRET'),
          scope: 'events:publish',
        },
      },
      proof: { jwksUrl: serviceUrl(env, 'PROOF_JWKS_URL'), issuer: env.PROOF_ISSUER || undefined },
    },
  };
}
