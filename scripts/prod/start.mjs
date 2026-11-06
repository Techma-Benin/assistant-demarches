import { spawn } from 'node:child_process';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { startPostgres } from '../dev/postgres.mjs';
import { startKeycloak } from '../dev/keycloak.mjs';
import { ROOT, RUNTIME, serviceEnvironment, showcaseConfig } from './config.mjs';
import { createGateway } from './gateway.mjs';
import { createDiagnostics, safeError } from './diagnostics.mjs';
import { startRuntimeDiagnostics } from './runtime-diagnostics.mjs';

const config = showcaseConfig();
const diagnostics = createDiagnostics();
const { emit } = diagnostics;
const stops = [];
let stopping = false;
let ready = false;
let startupFailure;
let stage = 'initializing';
let stopDiagnostics = () => {};
const gateway = createGateway({ ...config, ready: () => ready, diagnostics: emit });
const setStage = (value) => {
  stage = value;
  emit('runtime.stage', { stage, ready, uptimeSeconds: Math.round(process.uptime()) });
};
const log = (name) => (chunk) => {
  for (const line of String(chunk).split('\n')) if (line.trim()) console.log(`[${name}] ${line}`);
};
async function stop(code, reason = 'shutdown') {
  if (stopping) return;
  stopping = true;
  ready = false;
  emit('runtime.shutdown', { exitCode: code, reason, stage });
  stopDiagnostics();
  const deadline = setTimeout(() => {
    emit('runtime.shutdown_deadline', { exitCode: code || 1 }, 'error');
    process.exit(code || 1);
  }, 15_000);
  gateway.close();
  gateway.closeAllConnections();
  for (const close of stops.reverse()) {
    try { await close(); } catch (error) { emit('runtime.stop_error', { error: safeError(error) }, 'error'); }
  }
  clearTimeout(deadline);
  process.exit(code);
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  emit('runtime.signal', { signal }); void stop(0, signal);
});
process.on('unhandledRejection', (error) => {
  emit('runtime.unhandled_rejection', { error: safeError(error), stage }, 'error');
  void stop(1, 'unhandled_rejection');
});
process.on('uncaughtExceptionMonitor', (error) => {
  emit('runtime.uncaught_exception', { error: safeError(error), stage }, 'error');
});

function observe(name, child, oneShot = false) {
  emit('process.spawn', { service: name, childPid: child.pid });
  child.on('error', (error) => emit('process.error', { service: name, childPid: child.pid, error: safeError(error) }, 'error'));
  child.on('exit', (code, signal) => {
    const expected = stopping || (oneShot && code === 0);
    emit('process.exit', { service: name, childPid: child.pid, code, signal, expected }, expected ? 'info' : 'error');
  });
}

function launch(name, args, cwd = ROOT) {
  const child = spawn(process.execPath, [
    '--import', pathToFileURL(join(ROOT, 'scripts/prod/service-diagnostics.mjs')).href, ...args,
  ], {
    cwd, env: {
      ...serviceEnvironment(name, config),
      SHOWCASE_DIAGNOSTICS_SERVICE: name, SHOWCASE_DIAGNOSTICS_BOOT_ID: diagnostics.bootId,
    }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  observe(name, child);
  child.stdout.on('data', log(name));
  child.stderr.on('data', log(name));
  const failed = () => {
    if (!stopping) {
      startupFailure = new Error(`${name} stopped unexpectedly`);
      console.error(startupFailure.message);
      void stop(1, `${name}_exit`);
    }
  };
  child.on('error', failed);
  child.on('exit', failed);
  stops.push(() => new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    const deadline = setTimeout(() => child.kill('SIGKILL'), 5000);
    child.once('exit', () => { clearTimeout(deadline); resolve(); });
    child.kill('SIGTERM');
  }));
  return child;
}

async function waitFor(url, service) {
  emit('service.readiness_start', { service });
  let attempts = 0;
  let lastStatus;
  let lastError;
  const started = Date.now();
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (startupFailure) throw startupFailure;
    attempts++;
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
      lastStatus = response.status;
      await response.body?.cancel();
      if (response.ok) {
        emit('service.ready', { service, attempts, elapsedMs: Date.now() - started });
        return;
      }
    } catch (error) { lastError = safeError(error); }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  emit('service.readiness_timeout', { service, attempts, lastStatus, lastError }, 'error');
  throw new Error(`Service did not become ready: ${service}`);
}

try {
  emit('runtime.boot', { mode: 'production', nodeVersion: process.version, port: config.port });
  stopDiagnostics = startRuntimeDiagnostics({
    diagnostics, gateway, state: () => ({ stage, ready, stopping }),
    services: [
      ...['backend', 'tooling', 'xroad'].map((name) => ({ name, url: `http://127.0.0.1:${config.ports[name]}/health` })),
      { name: 'keycloak', url: `${config.urls.issuerInternal}/.well-known/openid-configuration` },
      { name: 'interface', url: `http://127.0.0.1:${config.ports.interface}/api/session` },
    ],
  });
  for (const file of [
    'apps/backend/dist/apps/backend/src/main.js', 'apps/tooling/dist/src/main.js',
    'apps/xroad-sim/dist/src/main.js', 'apps/interface/web/.next-showcase/BUILD_ID',
  ]) if (!existsSync(join(ROOT, file))) throw new Error('Missing production build. Run pnpm build:showcase first.');
  mkdirSync(join(config.local, 'keys'), { recursive: true });
  const signingFile = config.services.backend.SIGNING_KEY_FILE;
  if (!existsSync(signingFile)) {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    writeFileSync(signingFile, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  }
  const sessionFile = config.services.interface.SESSION_SECRET_FILE;
  if (!existsSync(sessionFile)) writeFileSync(sessionFile, randomBytes(32).toString('base64url'), { mode: 0o600 });
  await new Promise((resolve, reject) => {
    gateway.once('error', reject);
    gateway.listen(config.port, '0.0.0.0', resolve);
  });
  console.log(`Showcase gateway listening on ${config.port}; waiting for private services.`);
  setStage('postgres');
  stops.push(await startPostgres(log('postgres'), {
    local: config.local, port: config.ports.postgres,
    databases: ['backend', 'tooling', 'xroad', 'keycloak'], postgres: { user: 'techma', password: 'techma' },
  }));
  setStage('keycloak');
  stops.push(await startKeycloak(log('keycloak'), {
    local: RUNTIME, ports: config.ports, urls: config.urls, publicDomain: true,
    startupTimeoutMs: 600_000, streamLogs: true,
    onProcess: (child) => observe('keycloak', child),
    productionDatabase: {
      url: `jdbc:postgresql://127.0.0.1:${config.ports.postgres}/keycloak`, user: 'techma', password: 'techma',
    },
  }));
  setStage('migrations');
  const migrate = spawn(process.execPath, ['apps/backend/dist/apps/backend/src/cli.js', 'migrate'], {
    cwd: ROOT, env: serviceEnvironment('backend', config), stdio: 'inherit',
  });
  observe('migrations', migrate, true);
  await new Promise((resolve, reject) => {
    migrate.once('error', reject);
    migrate.once('exit', (code) => code === 0 ? resolve() : reject(new Error('Backend migrations failed')));
  });
  setStage('application_services');
  launch('xroad', ['apps/xroad-sim/dist/src/main.js']);
  launch('tooling', ['apps/tooling/dist/src/main.js']);
  launch('backend', ['apps/backend/dist/apps/backend/src/main.js']);
  await Promise.all(['xroad', 'tooling', 'backend'].map((name) => waitFor(`http://127.0.0.1:${config.ports[name]}/health`, name)));
  setStage('interface');
  launch('interface', ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(config.ports.interface)],
    join(ROOT, 'apps/interface/web'));
  await waitFor(`http://127.0.0.1:${config.ports.interface}`, 'interface');
  ready = true;
  setStage('ready');
  console.log(`Simulation ready at ${config.origin}. Demo accounts and simulated login remain enabled; never enter real personal data.`);
} catch (error) {
  emit('runtime.startup_error', { stage, error: safeError(error) }, 'error');
  console.error(error instanceof Error ? error.message : 'Showcase startup failed');
  await stop(1);
}
