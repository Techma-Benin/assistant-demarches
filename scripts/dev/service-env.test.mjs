import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SERVICES } from './local-config.mjs';
import { dropStaleLocalEnv, serviceEnv, staleLocalKeys } from './service-env.mjs';

const spilled = {
  PATH: '/usr/bin',
  MODEL_API_KEY: 'groq-test',
  DATABASE_URL: 'postgres://techma:techma@127.0.0.1:54329/backend',
  OIDC_CLIENT_ID: 'backend',
  OIDC_CLIENT_SECRET: 'backend-local-secret',
  PORT: '4010',
  SIGNING_KEY_FILE: '/tmp/backend-signing.pem',
};

test('`.env` values set for the backend do not apply to tooling, xroad or interface', () => {
  const tooling = serviceEnv('tooling', spilled, SERVICES);
  const xroad = serviceEnv('xroad', spilled, SERVICES);
  const web = serviceEnv('interface', spilled, SERVICES);
  assert.equal(tooling.DATABASE_URL, SERVICES.tooling.env.DATABASE_URL);
  assert.equal(xroad.DATABASE_URL, SERVICES.xroad.env.DATABASE_URL);
  assert.equal(tooling.OIDC_CLIENT_ID, 'tooling');
  assert.equal(web.OIDC_CLIENT_ID, 'interface');
  assert.equal(web.PORT, SERVICES.interface.env.PORT);
  assert.equal(tooling.SIGNING_KEY_FILE, undefined);
  assert.equal(tooling.MODEL_API_KEY, 'groq-test');
  assert.equal(xroad.MODEL_API_KEY, 'groq-test');
});

test('backend still receives unique `.env` overrides and its own defaults for shared keys', () => {
  const backend = serviceEnv('backend', spilled, SERVICES);
  assert.equal(backend.DATABASE_URL, SERVICES.backend.env.DATABASE_URL);
  assert.equal(backend.OIDC_CLIENT_ID, 'backend');
  assert.equal(backend.SIGNING_KEY_FILE, '/tmp/backend-signing.pem');
  assert.equal(backend.MODEL_API_KEY, 'groq-test');
  assert.equal(backend.NODE_ENV, 'development');
});

test('a stale .env on :5432 / :4020 is ignored in favour of local defaults', () => {
  const stale = {
    PATH: '/usr/bin',
    MODEL_API_KEY: 'only-key',
    DATABASE_URL: 'postgres://techma:techma@127.0.0.1:5432/backend',
    TOOLING_URL: 'http://127.0.0.1:4020',
    MCP_ALLOWED_URLS: 'http://127.0.0.1:4020/mcp',
    TOOLING_MCP_URL: 'http://127.0.0.1:4020/mcp',
  };
  assert.deepEqual(staleLocalKeys(stale), ['DATABASE_URL', 'TOOLING_URL', 'TOOLING_MCP_URL', 'MCP_ALLOWED_URLS']);
  const backend = serviceEnv('backend', stale, SERVICES);
  assert.equal(backend.DATABASE_URL, SERVICES.backend.env.DATABASE_URL);
  assert.equal(backend.TOOLING_URL, SERVICES.backend.env.TOOLING_URL);
  assert.equal(backend.MCP_ALLOWED_URLS, SERVICES.backend.env.MCP_ALLOWED_URLS);
  assert.equal(backend.MODEL_API_KEY, 'only-key');
  const copy = { ...stale };
  assert.deepEqual(dropStaleLocalEnv(copy), ['DATABASE_URL', 'TOOLING_URL', 'TOOLING_MCP_URL', 'MCP_ALLOWED_URLS']);
  assert.equal(copy.DATABASE_URL, undefined);
  assert.equal(copy.MODEL_API_KEY, 'only-key');
});

test('a remote DATABASE_URL is kept', () => {
  const remote = {
    DATABASE_URL: 'postgres://techma:techma@db.example.test:5432/backend',
    MODEL_API_KEY: 'only-key',
  };
  assert.deepEqual(staleLocalKeys(remote), []);
});
