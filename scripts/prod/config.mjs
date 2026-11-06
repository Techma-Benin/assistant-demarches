import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const RUNTIME = join(ROOT, '.local', 'showcase-runtime') + '/';

export function showcaseConfig(env = process.env) {
  if (!env.SHOWCASE_PUBLIC_URL) {
    throw new Error('Set SHOWCASE_PUBLIC_URL to the exact published HTTPS origin in production settings. A preview URL is not a production URL.');
  }
  const publicUrl = new URL(env.SHOWCASE_PUBLIC_URL);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(publicUrl.hostname);
  if ((!loopback && publicUrl.protocol !== 'https:') || !['http:', 'https:'].includes(publicUrl.protocol)
      || publicUrl.username || publicUrl.password || publicUrl.pathname !== '/'
      || publicUrl.search || publicUrl.hash || publicUrl.hostname.endsWith('.replit.dev')) {
    throw new Error('SHOWCASE_PUBLIC_URL must be a production HTTPS origin, without credentials, path, query, or fragment. Loopback HTTP is allowed only for local verification.');
  }
  const port = Number(env.PORT || 5000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be a valid TCP port.');
  const ports = { interface: 3100, backend: 4110, tooling: 4130, xroad: 4140, keycloak: 8181, postgres: 54339 };
  if (Object.values(ports).includes(port)) throw new Error('PORT conflicts with a private service port.');
  const local = resolve(env.SHOWCASE_DATA_DIR || join(ROOT, '.local', 'showcase-data')) + '/';
  const internal = (name) => `http://127.0.0.1:${ports[name]}`;
  const origin = publicUrl.origin;
  const issuer = `${origin}/keycloak/realms/techma`;
  const database = (name) => `postgres://techma:techma@127.0.0.1:${ports.postgres}/${name}`;
  const npi = env.NPI_SIMULATED_LOGIN || 'on';
  const services = {
    backend: {
      HOST: '127.0.0.1', PORT: String(ports.backend), PUBLIC_URL: origin,
      DATABASE_URL: database('backend'), OIDC_ISSUER: issuer,
      OIDC_JWKS_URL: `${internal('keycloak')}/realms/techma/protocol/openid-connect/certs`,
      OIDC_CLIENT_ID: 'backend', OIDC_CLIENT_SECRET: 'backend-local-secret',
      SIGNING_KEY_FILE: join(local, 'keys', 'backend-signing.pem'),
      FILE_STORAGE_DIR: join(local, 'files'), STORAGE_DRIVER: 'local',
      TOOLING_URL: internal('tooling'), TOOLING_MCP_URL: `${internal('tooling')}/mcp`,
      MCP_ALLOWED_URLS: `${internal('tooling')}/mcp`,
      XROAD_URL: internal('xroad'), CORS_ORIGINS: origin, NPI_SIMULATED_LOGIN: npi,
    },
    tooling: {
      HOST: '127.0.0.1', TOOLING_HOST: '127.0.0.1', TOOLING_PORT: String(ports.tooling),
      DATABASE_URL: database('tooling'), OIDC_ISSUER: issuer,
      OIDC_CLIENT_ID: 'tooling', OIDC_CLIENT_SECRET: 'tooling-local-secret',
      BACKEND_URL: internal('backend'), BACKEND_JWKS_URL: `${internal('backend')}/.well-known/jwks.json`,
      XROAD_URL: internal('xroad'),
    },
    xroad: {
      XROAD_HOST: '127.0.0.1', XROAD_PORT: String(ports.xroad),
      DATABASE_URL: database('xroad'), OIDC_ISSUER: issuer,
      CATALOGUE_FILE: join(ROOT, 'content', 'service-public', 'catalogue.json'),
    },
    interface: {
      PORT: String(ports.interface), PUBLIC_URL: origin, BACKEND_URL: internal('backend'),
      OIDC_ISSUER: issuer, OIDC_CLIENT_ID: 'interface', OIDC_CLIENT_SECRET: 'interface-local-secret',
      SESSION_SECRET_FILE: join(local, 'keys', 'interface-session.key'), NPI_SIMULATED_LOGIN: npi,
    },
  };
  return { port, ports, local, origin, services, urls: {
    interface: origin, keycloak: internal('keycloak'), keycloakPublic: `${origin}/keycloak`,
    issuer, issuerInternal: `${internal('keycloak')}/realms/techma`,
  } };
}

export function serviceEnvironment(name, config, env = process.env) {
  // Never accidentally use the workspace DB or service-specific development values.
  const isolated = { ...env };
  for (const service of Object.values(config.services)) {
    for (const key of Object.keys(service)) delete isolated[key];
  }
  for (const key of ['PGHOST', 'PGPORT', 'PGUSER', 'PGPASSWORD', 'PGDATABASE']) delete isolated[key];
  return { ...isolated, ...config.services[name], NODE_ENV: 'production', SHOWCASE_PRODUCTION: '1' };
}
