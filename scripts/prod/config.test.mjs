import assert from 'node:assert/strict';
import test from 'node:test';
import { showcaseConfig, serviceEnvironment } from './config.mjs';
import { SERVICES } from '../dev/local-config.mjs';

test('requires an explicit production URL, rejecting preview URLs and unsafe origins', () => {
  for (const value of [undefined, 'http://demo.example', 'https://demo.replit.dev', 'https://demo.example/path',
    'https://user:pass@demo.example', 'https://demo.example/?query=1', 'https://demo.example/#fragment']) {
    assert.throws(() => showcaseConfig({ SHOWCASE_PUBLIC_URL: value }));
  }
  assert.equal(showcaseConfig({ SHOWCASE_PUBLIC_URL: 'https://showcase.example' }).origin, 'https://showcase.example');
});
test('browser URLs all use one origin; private ports and storage do not overlap development', () => {
  const config = showcaseConfig({ SHOWCASE_PUBLIC_URL: 'https://showcase.example' });
  assert.equal(config.services.backend.PUBLIC_URL, config.services.interface.PUBLIC_URL);
  assert.equal(config.services.interface.OIDC_ISSUER, 'https://showcase.example/keycloak/realms/techma');
  for (const name of ['backend', 'tooling', 'xroad']) {
    assert.notEqual(config.services[name].DATABASE_URL, SERVICES[name]?.env.DATABASE_URL);
  }
  assert.notEqual(config.services.interface.SESSION_SECRET_FILE, SERVICES.interface.env.SESSION_SECRET_FILE);
  assert.notEqual(config.services.backend.FILE_STORAGE_DIR, SERVICES.backend.env.FILE_STORAGE_DIR);
  assert.throws(() => showcaseConfig({ SHOWCASE_PUBLIC_URL: 'https://showcase.example', PORT: '4110' }));
});
test('production environment cannot inherit shared development service/database values', () => {
  const config = showcaseConfig({ SHOWCASE_PUBLIC_URL: 'http://127.0.0.1:5000' });
  const result = serviceEnvironment('interface', config, {
    NODE_ENV: 'development', DATABASE_URL: 'wrong-db', PGHOST: 'wrong-host',
    PUBLIC_URL: 'https://wrong.example', OIDC_CLIENT_ID: 'wrong-client', MODEL_PROVIDER: 'openai',
  });
  assert.equal(result.NODE_ENV, 'production');
  assert.equal(result.SHOWCASE_PRODUCTION, '1');
  assert.equal(result.PUBLIC_URL, 'http://127.0.0.1:5000');
  assert.equal(result.OIDC_CLIENT_ID, 'interface');
  assert.equal(result.MODEL_PROVIDER, 'openai');
  assert.equal(result.DATABASE_URL, undefined);
  assert.equal(result.PGHOST, undefined);
});
