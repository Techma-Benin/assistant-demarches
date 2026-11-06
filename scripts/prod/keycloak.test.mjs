import assert from 'node:assert/strict';
import test from 'node:test';
import { waitForRealm } from '../dev/keycloak.mjs';

const urls = { issuerInternal: 'http://127.0.0.1:8181/realms/techma' };
const runningChild = () => ({ exitCode: null, signalCode: null });

function fakeClock(t) {
  let clock = 0;
  t.mock.method(Date, 'now', () => clock);
  t.mock.method(globalThis, 'setTimeout', (callback, milliseconds) => {
    clock += milliseconds;
    queueMicrotask(callback);
  });
  return () => clock;
}

test('development retains its three-minute readiness deadline', async (t) => {
  const clock = fakeClock(t);
  t.mock.method(globalThis, 'fetch', async () => ({ ok: false }));
  await assert.rejects(waitForRealm(runningChild(), urls), /180 secondes/);
  assert.equal(clock(), 180_000);
});

test('production can complete a cold start beyond the development deadline', async (t) => {
  const clock = fakeClock(t);
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, `${urls.issuerInternal}/.well-known/openid-configuration`);
    assert.ok(options.signal instanceof AbortSignal);
    return { ok: clock() >= 210_000 };
  });
  await waitForRealm(runningChild(), urls, { timeoutMs: 600_000 });
  assert.equal(clock(), 210_000);
});

test('production still fails explicitly after its longer deadline', async (t) => {
  const clock = fakeClock(t);
  t.mock.method(globalThis, 'fetch', async () => ({ ok: false }));
  await assert.rejects(waitForRealm(runningChild(), urls, { timeoutMs: 600_000 }), /600 secondes/);
  assert.equal(clock(), 600_000);
});

test('hung discovery requests are aborted rather than bypassing the deadline', async (t) => {
  let attempts = 0;
  t.mock.method(globalThis, 'fetch', (_url, { signal }) => new Promise((_resolve, reject) => {
    attempts++;
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  }));
  // AbortSignal timeout timers are unreferenced; keep this isolated test alive.
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    await assert.rejects(waitForRealm(runningChild(), urls, {
      timeoutMs: 50, requestTimeoutMs: 10, pollIntervalMs: 1,
    }), /Keycloak n’a pas répondu/);
    assert.ok(attempts > 1);
  } finally {
    clearTimeout(keepAlive);
  }
});

test('a terminated identity process fails without waiting for the deadline', async () => {
  await assert.rejects(waitForRealm({ exitCode: 1, signalCode: null }, urls), /s’est arrêté/);
  await assert.rejects(waitForRealm({ exitCode: null, signalCode: 'SIGKILL' }, urls), /s’est arrêté/);
});
