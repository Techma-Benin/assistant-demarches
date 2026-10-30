import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net, { type AddressInfo } from 'node:net';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { supervise } from '../src/runtime/supervisor.js';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const SERVICE_START_MS = 60_000;

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

function startService(port: number, ipc: boolean) {
  const child = spawn(process.execPath, [fileURLToPath(new URL('../src/cluster.js', import.meta.url))], {
    env: { ...process.env, AUTH_MODE: 'mock-tokens', TOOLING_PORT: String(port), DATABASE_URL: 'pglite:memory', EVENTS_PUBLISHER: 'off' },
    stdio: ipc ? ['ignore', 'pipe', 'pipe', 'ipc'] : ['ignore', 'pipe', 'pipe'],
  });
  const state = { output: '' };
  child.stdout!.on('data', (chunk) => (state.output += chunk));
  child.stderr!.on('data', (chunk) => (state.output += chunk));
  const exited = new Promise<number | null>((resolve) => child.once('exit', resolve));
  return { child, state, exited };
}

test('service réel : processus tué relancé, puis arrêt propre demandé par IPC (tous systèmes)', async (t) => {
  const port = await freePort();
  const { child, state, exited } = startService(port, true);
  t.after(() => {
    if (child.exitCode === null) child.kill('SIGKILL');
  });
  const health = `http://127.0.0.1:${port}/health`;
  await until(() => get(health), SERVICE_START_MS);
  const pid = Number(/prêt \(pid (\d+)\)/.exec(state.output)?.[1]);
  assert.ok(pid > 0, state.output);

  process.kill(pid, 'SIGKILL');
  await until(async () => /processus 0 arrêté/.test(state.output), 5000);
  await until(async () => new RegExp(`prêt \\(pid (?!${pid}\\))\\d+\\)`).test(state.output) && (await get(health)), SERVICE_START_MS);

  child.send({ type: 'shutdown' });
  assert.equal(await exited, 0);
  assert.match(state.output, /arrêt terminé/);
  assert.equal(await get(health), undefined);
});

test('service réel : arrêt propre sur SIGTERM, comme Docker', { skip: process.platform === 'win32' && 'SIGTERM non pris en charge par Windows' }, async (t) => {
  const port = await freePort();
  const { child, state, exited } = startService(port, false);
  t.after(() => {
    if (child.exitCode === null) child.kill('SIGKILL');
  });
  await until(() => get(`http://127.0.0.1:${port}/health`), SERVICE_START_MS);
  child.kill('SIGTERM');
  assert.equal(await exited, 0);
  assert.match(state.output, /SIGTERM reçu/);
  assert.match(state.output, /arrêt terminé/);
});
