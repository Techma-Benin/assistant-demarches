import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { ConfigError, loadConfig } from '../src/config.js';
import { assertSchema, startTooling, TRACEPARENT } from './helpers.js';

test('sondes : /health (processus) et /ready (base et schéma) sans traceparent', async (t) => {
  const url = await startTooling(t, { AUTH_MODE: 'mock-tokens' });
  const res = await fetch(`${url}/health`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { status: 'ok' });
  const ready = await fetch(`${url}/ready`);
  assert.equal(ready.status, 200);
  assert.deepEqual(await ready.json(), { status: 'ready' });
});

test('traceparent absent, mal formé ou nul : 400 problem+json', async (t) => {
  const url = await startTooling(t, { AUTH_MODE: 'mock-tokens' });
  for (const traceparent of [undefined, 'invalid', `00-${'0'.repeat(32)}-${'2'.repeat(16)}-01`, `00-${'1'.repeat(32)}-${'0'.repeat(16)}-01`]) {
    const res = await fetch(`${url}/internal/v1/unknown`, { headers: traceparent ? { traceparent } : {} });
    assert.equal(res.status, 400, String(traceparent));
    assert.match(res.headers.get('content-type') ?? '', /^application\/problem\+json/);
    const problem = (await res.json()) as { code: string; traceId: string };
    assertSchema('Problem', problem);
    assert.equal(problem.code, 'INVALID_REQUEST');
  }
});

test('route inconnue : 404 avec le traceId de la requête, sans détail interne', async (t) => {
  const url = await startTooling(t, { AUTH_MODE: 'mock-tokens' });
  const res = await fetch(`${url}/nothing-here`, { headers: { traceparent: TRACEPARENT } });
  assert.equal(res.status, 404);
  const problem = (await res.json()) as { code: string; traceId: string };
  assertSchema('Problem', problem);
  assert.equal(problem.code, 'NOT_FOUND');
  assert.equal(problem.traceId, '1'.repeat(32));
});

test('en-têtes de sécurité présents, X-Powered-By absent', async (t) => {
  const url = await startTooling(t, { AUTH_MODE: 'mock-tokens' });
  const res = await fetch(`${url}/health`);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.match(res.headers.get('content-security-policy') ?? '', /default-src 'none'/);
  assert.match(res.headers.get('strict-transport-security') ?? '', /max-age=/);
  assert.equal(res.headers.get('x-powered-by'), null);
});

test('jetons de simulation refusés hors écoute locale ou en production', () => {
  assert.throws(() => loadConfig({ AUTH_MODE: 'mock-tokens', TOOLING_HOST: '0.0.0.0' }), ConfigError);
  assert.throws(() => loadConfig({ AUTH_MODE: 'mock-tokens', NODE_ENV: 'production' }), ConfigError);
  assert.throws(() => loadConfig({ AUTH_MODE: 'other' }), ConfigError);
  assert.throws(() => loadConfig({ TOOLING_PORT: '99999' }), ConfigError);
  assert.equal(loadConfig({ AUTH_MODE: 'mock-tokens' }).authMode, 'mock-tokens');
});

test('mode jwt : realm complet exigé, HTTPS obligatoire hors localhost', () => {
  const realm = {
    JWT_ISSUER: 'https://idp.example/realms/techma',
    JWKS_URL: 'https://idp.example/realms/techma/protocol/openid-connect/certs',
    OIDC_TOKEN_URL: 'https://idp.example/realms/techma/protocol/openid-connect/token',
    TOOLING_RESOURCES_CLIENT_ID: 'tooling-resources',
    TOOLING_RESOURCES_CLIENT_SECRET: 'secret',
    TOOLING_EVENTS_CLIENT_ID: 'tooling-events',
    TOOLING_EVENTS_CLIENT_SECRET: 'secret',
    PROOF_JWKS_URL: 'https://backend.example/.well-known/mandate-jwks.json',
  };
  assert.equal(loadConfig(realm).authMode, 'jwt');
  assert.throws(() => loadConfig({}), ConfigError);
  assert.throws(() => loadConfig({ ...realm, TOOLING_RESOURCES_CLIENT_SECRET: '' }), ConfigError);
  assert.throws(() => loadConfig({ ...realm, JWKS_URL: 'http://idp.example/certs' }), ConfigError);
  assert.throws(() => loadConfig({ ...realm, BACKEND_URL: 'http://backend.internal' }), ConfigError);
  assert.throws(() => loadConfig({ ...realm, NODE_ENV: 'production' }), ConfigError, 'BACKEND_URL requis en production');
  const prod = { ...realm, NODE_ENV: 'production', BACKEND_URL: 'https://backend.internal' };
  assert.throws(() => loadConfig(prod), ConfigError, 'DATABASE_URL requis en production');
  assert.throws(() => loadConfig({ ...prod, DATABASE_URL: 'pglite:memory' }), ConfigError);
  assert.throws(() => loadConfig({ ...prod, DATABASE_URL: 'postgres://u:p@db/tooling', PROCEDURES_ALLOW_DRAFTS: 'true' }), ConfigError);
  const production = loadConfig({ ...prod, DATABASE_URL: 'postgres://u:p@db/tooling' });
  assert.equal(production.allowDraftProcedures, false);
  assert.equal(production.workers, 2);
  assert.throws(() => loadConfig({ AUTH_MODE: 'mock-tokens', TOOLING_WORKERS: '2' }), ConfigError, 'PGlite ne se partage pas');
  assert.equal(loadConfig({ ...realm, BACKEND_URL: 'https://backend.internal' }).backendUrl.host, 'backend.internal');

  const { OIDC_TOKEN_URL: _url, TOOLING_RESOURCES_CLIENT_SECRET: _secret, ...withoutCredentials } = realm;
  const preissued = loadConfig({ ...withoutCredentials, TOOLING_RESOURCES_TOKEN: 'a.b.c', TOOLING_EVENTS_CLIENT_SECRET: 'secret', OIDC_TOKEN_URL: realm.OIDC_TOKEN_URL });
  assert.deepEqual(preissued.jwt?.clients['tooling-resources'], { scope: 'resources:read', token: 'a.b.c' });
  assert.throws(() => loadConfig({ ...withoutCredentials, TOOLING_RESOURCES_TOKEN: 'a.b.c' }), ConfigError, 'OIDC_TOKEN_URL reste requis pour tooling-events');
  assert.throws(() => loadConfig({ ...realm, TOOLING_EVENTS_TOKEN: 'avec espace' }), ConfigError);
  assert.throws(() => loadConfig({ ...prod, DATABASE_URL: 'postgres://u:p@db/tooling', TOOLING_EVENTS_TOKEN: 'a.b.c' }), ConfigError, 'jeton préémis interdit en production');
});

test('CONTRACTS_DIR accepte un chemin natif du système (dont C:\\… sous Windows)', async () => {
  const dir = resolve(fileURLToPath(new URL('../../../../contracts/v1', import.meta.url)));
  const module = pathToFileURL(fileURLToPath(new URL('../src/contracts.js', import.meta.url))).href;
  const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', `const c = await import(${JSON.stringify(module)}); console.log(c.catalog.tools.length)`], {
    env: { ...process.env, CONTRACTS_DIR: dir },
  });
  assert.equal(stdout.trim(), '9');
});
