// Local development configuration, shared by every service started by `pnpm dev`.
// The client secrets match infra/keycloak/realm-techma.json and are valid on this machine only.
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const LOCAL = fileURLToPath(new URL('../../.local/', import.meta.url));
export const PREVIEW_DOMAIN = process.env.REPLIT_DEV_DOMAIN?.trim();

// KEYCLOAK_PORT (shell variable): for machines where 8080 is taken, by an Oracle or EnterpriseDB service on Windows for example.
export const PORTS = { interface: 3000, backend: 4010, tooling: 4030, xroad: 4040, keycloak: Number(process.env.KEYCLOAK_PORT ?? 8080), postgres: 54329 };
export const KEYCLOAK_VERSION = '26.8.1';
export const JAVA_VERSION = 21;
export const DATABASES = ['backend', 'tooling', 'xroad'];
export const POSTGRES = { user: 'techma', password: 'techma' };

const url = (port) => `http://127.0.0.1:${port}`;
const previewUrl = (port) => PREVIEW_DOMAIN
  ? `https://${PREVIEW_DOMAIN}${port ? `:${port}` : ''}`
  : undefined;
const previewBackendPort = 3000;
const publicKeycloak = PREVIEW_DOMAIN
  ? `${previewUrl()}/keycloak`
  : url(PORTS.keycloak);
const publicInterface = previewUrl() ?? url(PORTS.interface);
export const URLS = {
  interface: publicInterface,
  backend: url(PORTS.backend),
  backendPublic: previewUrl(previewBackendPort) ?? url(PORTS.backend),
  tooling: url(PORTS.tooling),
  xroad: url(PORTS.xroad),
  keycloak: url(PORTS.keycloak),
  keycloakPublic: publicKeycloak,
  issuer: `${publicKeycloak}/realms/techma`,
  issuerInternal: `${url(PORTS.keycloak)}/realms/techma`,
};
const database = (name) => `postgres://${POSTGRES.user}:${POSTGRES.password}@127.0.0.1:${PORTS.postgres}/${name}`;

/** Switches that the Backend and the Interface must agree on: a value set in `.env` wins over the default below. */
export const SHARED_SWITCHES = new Set(['NPI_SIMULATED_LOGIN']);

/** Per-service defaults for `pnpm dev`. Shared keys (DATABASE_URL, OIDC_CLIENT_ID, …) never leak from `.env` to another service. */
export const SERVICES = {
  backend: {
    package: '@techma/backend',
    env: {
      HOST: PREVIEW_DOMAIN ? '0.0.0.0' : '127.0.0.1',
      PORT: String(PORTS.backend),
      PUBLIC_URL: URLS.backendPublic,
      DATABASE_URL: database('backend'),
      OIDC_ISSUER: URLS.issuer,
      OIDC_CLIENT_ID: 'backend',
      OIDC_CLIENT_SECRET: 'backend-local-secret',
      SIGNING_KEY_FILE: `${LOCAL}keys/backend-signing.pem`,
      FILE_STORAGE_DIR: `${LOCAL}files`,
      TOOLING_URL: URLS.tooling,
      TOOLING_MCP_URL: `${URLS.tooling}/mcp`,
      XROAD_URL: URLS.xroad,
      CORS_ORIGINS: URLS.interface,
      MCP_ALLOWED_URLS: `${URLS.tooling}/mcp`,
      NPI_SIMULATED_LOGIN: 'on',
    },
  },
  tooling: {
    package: '@techma/tooling',
    env: {
      TOOLING_PORT: String(PORTS.tooling),
      DATABASE_URL: database('tooling'),
      OIDC_ISSUER: URLS.issuer,
      OIDC_CLIENT_ID: 'tooling',
      OIDC_CLIENT_SECRET: 'tooling-local-secret',
      BACKEND_URL: URLS.backend,
      BACKEND_JWKS_URL: `${URLS.backend}/.well-known/jwks.json`,
      XROAD_URL: URLS.xroad,
    },
  },
  xroad: {
    package: '@techma/xroad-sim',
    env: {
      XROAD_PORT: String(PORTS.xroad),
      DATABASE_URL: database('xroad'),
      OIDC_ISSUER: URLS.issuer,
      CATALOGUE_FILE: `${ROOT}content/service-public/catalogue.json`,
    },
  },
  interface: {
    package: '@techma/interface',
    env: {
      PORT: String(PORTS.interface),
      PUBLIC_URL: URLS.interface,
      BACKEND_URL: URLS.backend,
      OIDC_ISSUER: URLS.issuer,
      OIDC_CLIENT_ID: 'interface',
      OIDC_CLIENT_SECRET: 'interface-local-secret',
      SESSION_SECRET_FILE: `${LOCAL}keys/interface-session.key`,
      NPI_SIMULATED_LOGIN: 'on',
    },
  },
};
