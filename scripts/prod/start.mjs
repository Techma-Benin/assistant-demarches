import { spawn } from 'node:child_process';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { startPostgres } from '../dev/postgres.mjs';
import { startKeycloak } from '../dev/keycloak.mjs';
import { ROOT, RUNTIME, serviceEnvironment, showcaseConfig } from './config.mjs';
import { createGateway } from './gateway.mjs';

const config = showcaseConfig();
const stops = [];
let stopping = false;
let ready = false;
let startupFailure;
const gateway = createGateway({ ...config, ready: () => ready });
const log = (name) => (chunk) => {
  for (const line of String(chunk).split('\n')) if (line.trim()) console.log(`[${name}] ${line}`);
};
async function stop(code) {
  if (stopping) return;
  stopping = true;
  ready = false;
  const deadline = setTimeout(() => process.exit(code || 1), 15_000);
  gateway.close();
  gateway.closeAllConnections();
  for (const close of stops.reverse()) {
    try { await close(); } catch { console.error('A showcase service did not close cleanly.'); }
  }
  clearTimeout(deadline);
  process.exit(code);
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => void stop(0));
process.on('unhandledRejection', (error) => { console.error(error); void stop(1); });

function launch(name, args, cwd = ROOT) {
  const child = spawn(process.execPath, args, {
    cwd, env: serviceEnvironment(name, config), stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', log(name));
  child.stderr.on('data', log(name));
  const failed = () => {
    if (!stopping) {
      startupFailure = new Error(`${name} stopped unexpectedly`);
      console.error(startupFailure.message);
      void stop(1);
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

async function waitFor(url) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (startupFailure) throw startupFailure;
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Service did not become ready: ${url}`);
}

try {
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
  stops.push(await startPostgres(log('postgres'), {
    local: config.local, port: config.ports.postgres,
    databases: ['backend', 'tooling', 'xroad', 'keycloak'], postgres: { user: 'techma', password: 'techma' },
  }));
  stops.push(await startKeycloak(log('keycloak'), {
    local: RUNTIME, ports: config.ports, urls: config.urls, publicDomain: true,
    productionDatabase: {
      url: `jdbc:postgresql://127.0.0.1:${config.ports.postgres}/keycloak`, user: 'techma', password: 'techma',
    },
  }));
  const migrate = spawn(process.execPath, ['apps/backend/dist/apps/backend/src/cli.js', 'migrate'], {
    cwd: ROOT, env: serviceEnvironment('backend', config), stdio: 'inherit',
  });
  await new Promise((resolve, reject) => {
    migrate.once('error', reject);
    migrate.once('exit', (code) => code === 0 ? resolve() : reject(new Error('Backend migrations failed')));
  });
  launch('xroad', ['apps/xroad-sim/dist/src/main.js']);
  launch('tooling', ['apps/tooling/dist/src/main.js']);
  launch('backend', ['apps/backend/dist/apps/backend/src/main.js']);
  await Promise.all(['xroad', 'tooling', 'backend'].map((name) => waitFor(`http://127.0.0.1:${config.ports[name]}/health`)));
  launch('interface', ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(config.ports.interface)],
    join(ROOT, 'apps/interface/web'));
  await waitFor(`http://127.0.0.1:${config.ports.interface}`);
  ready = true;
  console.log(`Simulation ready at ${config.origin}. Demo accounts and simulated login remain enabled; never enter real personal data.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Showcase startup failed');
  await stop(1);
}
