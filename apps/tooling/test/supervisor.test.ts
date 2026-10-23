import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net, { type AddressInfo } from 'node:net';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { supervise } from '../src/runtime/supervisor.js';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function freePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

async function get(url: string, timeoutMs = 500): Promise<string | undefined> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return await res.text();
  } catch {
    return undefined;
  }
}

async function until<T>(probe: () => Promise<T | undefined | false>, timeoutMs = 10_000): Promise<T> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value) return value;
    if (Date.now() > end) throw new Error('Délai dépassé');
    await sleep(100);
  }
}

test('superviseur : processus arrêté relancé, processus bloqué remplacé, service continu', async (t) => {
  const port = await freePort();
  process.env.FIXTURE_PORT = String(port);
  const logs: string[] = [];
  const supervisor = supervise({
    workers: 2,
    exec: fileURLToPath(new URL('./fixtures/worker.js', import.meta.url)),
    heartbeatTimeoutMs: 1500,
    baseBackoffMs: 100,
    handleSignals: false,
    log: (message) => logs.push(message),
  });
  t.after(() => supervisor.stop());
  const base = `http://127.0.0.1:${port}`;
  await until(async () => supervisor.pids().length === 2 && (await get(`${base}/pid`)));
  const initial = supervisor.pids();

  await get(`${base}/crash`);
  await until(async () => (await get(`${base}/pid`)) !== undefined);
  await until(async () => supervisor.pids().length === 2 && supervisor.pids().some((pid) => !initial.includes(pid)));
  assert.ok(logs.some((line) => /arrêté \(code 1/.test(line)));

  const beforeHang = supervisor.pids();
  void get(`${base}/hang`, 100);
  await until(async () => logs.some((line) => /ne répond plus/.test(line)), 8000);
  await until(async () => supervisor.pids().length === 2 && supervisor.pids().filter((pid) => !beforeHang.includes(pid)).length === 1, 8000);
  assert.ok(await until(() => get(`${base}/pid`)));

  await supervisor.stop();
  assert.equal(supervisor.pids().length, 0);
});

test('service réel : processus tué relancé par le superviseur, /health de retour', async (t) => {
  const port = await freePort();
  const child = spawn(process.execPath, [fileURLToPath(new URL('../src/cluster.js', import.meta.url))], {
    env: { ...process.env, AUTH_MODE: 'mock-tokens', TOOLING_PORT: String(port), DATABASE_URL: 'pglite:memory', EVENTS_PUBLISHER: 'off' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => (output += chunk));
  child.stderr.on('data', (chunk) => (output += chunk));
  t.after(() => {
    child.kill('SIGTERM');
  });
  const health = `http://127.0.0.1:${port}/health`;
  await until(() => get(health), 20_000);
  const pid = Number(/prêt \(pid (\d+)\)/.exec(output)?.[1]);
  assert.ok(pid > 0, output);

  process.kill(pid, 'SIGKILL');
  await until(async () => /arrêté \(code -, signal SIGKILL\)/.test(output), 5000);
  await until(async () => new RegExp(`prêt \\(pid (?!${pid}\\))\\d+\\)`).test(output) && (await get(health)), 20_000);

  const exited = new Promise<number | null>((resolve) => child.once('exit', resolve));
  child.kill('SIGTERM');
  assert.equal(await exited, 0);
  assert.match(output, /arrêt terminé/);
});
