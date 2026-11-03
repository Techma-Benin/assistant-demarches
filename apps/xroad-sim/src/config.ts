export interface SimConfig {
  host: string;
  port: number;
  databaseUrl: string;
  issuer: string;
  jwksUrl: URL;
  catalogueFile: string;
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
  const host = env.XROAD_HOST ?? '127.0.0.1';
  const port = Number(env.XROAD_PORT ?? 4040);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new ConfigError('XROAD_PORT invalide');

  const issuer = required(env, 'OIDC_ISSUER').replace(/\/$/, '');
  const jwksUrl = new URL(`${issuer}/protocol/openid-connect/certs`);
  if (jwksUrl.protocol !== 'https:' && !(jwksUrl.protocol === 'http:' && LOCAL_HOSTS.has(jwksUrl.hostname))) {
    throw new ConfigError('OIDC_ISSUER doit être en HTTPS hors localhost');
  }
  return { host, port, databaseUrl: required(env, 'DATABASE_URL'), issuer, jwksUrl, catalogueFile: required(env, 'CATALOGUE_FILE') };
}
