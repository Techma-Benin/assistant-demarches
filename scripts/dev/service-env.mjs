import { PORTS } from './local-config.mjs';

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

function urlsOf(value) {
  return String(value).split(',').map((item) => item.trim()).filter(Boolean);
}

function loopbackPort(value) {
  try {
    const parsed = new URL(value);
    if (!LOOPBACK.has(parsed.hostname)) return undefined;
    return parsed.port || (parsed.protocol === 'https:' ? '443' : '80');
  } catch {
    return undefined;
  }
}

/** Leftover local URLs from an older stack (Postgres :5432, Tooling :4020) that break `pnpm dev`. */
export function staleLocalKeys(env) {
  const stale = [];
  if (env.DATABASE_URL && loopbackPort(env.DATABASE_URL) === '5432' && String(PORTS.postgres) !== '5432')
    stale.push('DATABASE_URL');
  for (const key of ['TOOLING_URL', 'TOOLING_MCP_URL', 'MCP_ALLOWED_URLS']) {
    if (!env[key]) continue;
    if (urlsOf(env[key]).some((url) => loopbackPort(url) === '4020') && String(PORTS.tooling) !== '4020')
      stale.push(key);
  }
  return stale;
}

export function dropStaleLocalEnv(env) {
  const keys = staleLocalKeys(env);
  for (const key of keys) delete env[key];
  return keys;
}

/** Build a child env that does not leak shared `.env` values (DATABASE_URL, OIDC_CLIENT_ID, …) across services. */
export function serviceEnv(name, processEnv, services) {
  const scoped = services[name].env;
  const owners = new Map();
  for (const [serviceName, service] of Object.entries(services)) {
    for (const key of Object.keys(service.env)) {
      const list = owners.get(key) ?? [];
      list.push(serviceName);
      owners.set(key, list);
    }
  }
  const env = { ...processEnv };
  dropStaleLocalEnv(env);
  for (const [key, names] of owners) {
    if (!names.includes(name)) {
      delete env[key];
      continue;
    }
    env[key] = names.length > 1 ? scoped[key] : (env[key] || scoped[key]);
  }
  if (!env.NODE_ENV) env.NODE_ENV = 'development';
  return env;
}
