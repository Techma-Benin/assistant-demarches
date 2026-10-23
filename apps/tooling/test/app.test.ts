import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConfigError, loadConfig } from '../src/config.js';
import { assertSchema, startTooling, TRACEPARENT } from './helpers.js';

test('la sonde de santé répond sans traceparent', async (t) => {
  const url = await startTooling(t);
  const res = await fetch(`${url}/health`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { status: 'ok' });
});

test('traceparent absent, mal formé ou nul : 400 problem+json', async (t) => {
  const url = await startTooling(t);
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
  const url = await startTooling(t);
  const res = await fetch(`${url}/nothing-here`, { headers: { traceparent: TRACEPARENT } });
  assert.equal(res.status, 404);
  const problem = (await res.json()) as { code: string; traceId: string };
  assertSchema('Problem', problem);
  assert.equal(problem.code, 'NOT_FOUND');
  assert.equal(problem.traceId, '1'.repeat(32));
});

test('en-têtes de sécurité présents, X-Powered-By absent', async (t) => {
  const url = await startTooling(t);
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
  assert.equal(loadConfig({}).authMode, 'jwt');
});
