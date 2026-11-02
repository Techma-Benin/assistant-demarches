import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { ConfigError, loadConfig } from '../src/config.js';
import { assertSchema, startStack, TRACEPARENT } from './helpers.js';

const BASE = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://u:p@127.0.0.1/tooling',
  OIDC_ISSUER: 'http://127.0.0.1:8080/realms/techma',
  OIDC_CLIENT_SECRET: 's',
  BACKEND_URL: 'http://127.0.0.1:4010',
  XROAD_URL: 'http://127.0.0.1:4040',
};

test('sondes : /health (processus) et /ready (base et schéma) sans traceparent', async (t) => {
  const s = await startStack(t);
  const health = await fetch(`${s.url}/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: 'ok' });
  const ready = await fetch(`${s.url}/ready`);
  assert.equal(ready.status, 200);
  assert.deepEqual(await ready.json(), { status: 'ready' });
});

test('route inconnue : 404 problem+json avec le traceId de la requête', async (t) => {
  const s = await startStack(t);
  const res = await fetch(`${s.url}/nothing-here`, { headers: { traceparent: TRACEPARENT } });
  assert.equal(res.status, 404);
  assert.match(res.headers.get('content-type') ?? '', /^application\/problem\+json/);
  const problem = (await res.json()) as { code: string; traceId: string };
  assertSchema('Problem', problem);
  assert.equal(problem.code, 'NOT_FOUND');
  assert.equal(problem.traceId, '1'.repeat(32));
});

test('traceparent facultatif : absent ou mal formé, le service en crée un et le renvoie dans les erreurs', async (t) => {
  const s = await startStack(t);
  for (const headers of [{}, { traceparent: 'invalid' }] as Record<string, string>[]) {
    const res = await fetch(`${s.url}/nothing-here`, { headers });
    assert.equal(res.status, 404);
    const problem = (await res.json()) as { traceId: string };
    assert.match(problem.traceId, /^[a-f0-9]{32}$/);
    assert.notEqual(problem.traceId, '0'.repeat(32));
  }
});

test('en-têtes de sécurité présents, X-Powered-By absent', async (t) => {
  const s = await startStack(t);
  const res = await fetch(`${s.url}/health`);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.match(res.headers.get('content-security-policy') ?? '', /default-src 'none'/);
  assert.equal(res.headers.get('x-powered-by'), null);
});

test('configuration : variables de pnpm dev, Keycloak dérivé de l’issuer, aucune authentification de développement', () => {
  const config = loadConfig(BASE);
  assert.equal(config.port, 4030);
  assert.equal(config.oidc.clientId, 'tooling');
  assert.equal(config.oidc.jwksUrl.href, 'http://127.0.0.1:8080/realms/techma/protocol/openid-connect/certs');
  assert.equal(config.oidc.tokenUrl.href, 'http://127.0.0.1:8080/realms/techma/protocol/openid-connect/token');
  assert.equal(config.backendJwksUrl.href, 'http://127.0.0.1:4010/.well-known/jwks.json');
  for (const name of ['OIDC_ISSUER', 'OIDC_CLIENT_SECRET', 'BACKEND_URL', 'XROAD_URL', 'DATABASE_URL']) {
    assert.throws(() => loadConfig({ ...BASE, [name]: undefined }), ConfigError, `${name} requis`);
  }
  assert.throws(() => loadConfig({ ...BASE, XROAD_URL: 'http://10.0.0.5:4040' }), ConfigError, 'HTTPS hors localhost');
  assert.throws(() => loadConfig({ ...BASE, OIDC_ISSUER: 'http://idp.example/realms/techma' }), ConfigError, 'HTTPS hors localhost');
  assert.throws(() => loadConfig({ ...BASE, NODE_ENV: 'development', DATABASE_URL: 'pglite:memory' }), ConfigError, 'PGlite réservé aux tests');
  assert.throws(() => loadConfig({ ...BASE, TOOLING_PORT: '99999' }), ConfigError);
  assert.equal(loadConfig({ ...BASE, DATABASE_URL: 'pglite:memory' }).database.kind, 'pglite');
  assert.equal('authMode' in config, false, 'plus de mode mock-tokens');
});

test('CONTRACTS_DIR accepte un chemin natif du système (dont C:\\… sous Windows)', async () => {
  const contracts = resolve(fileURLToPath(new URL('../../../../contracts/v2', import.meta.url)));
  const module = pathToFileURL(fileURLToPath(new URL('../src/contracts.js', import.meta.url))).href;
  const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', `const c = await import(${JSON.stringify(module)}); console.log(c.catalog.tools.length)`], {
    env: { ...process.env, CONTRACTS_DIR: contracts },
  });
  assert.equal(stdout.trim(), '9');
});
