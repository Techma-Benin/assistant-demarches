// pnpm dev            : PostgreSQL + Keycloak + every application
// pnpm dev:infra      : PostgreSQL + Keycloak only (to run one application yourself)
// pnpm dev backend …  : PostgreSQL + Keycloak + the listed applications
// pnpm dev:reset      : deletes local data (databases, Keycloak realm, files), keeps the downloads
import { spawn } from 'node:child_process';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { KEYCLOAK_VERSION, LOCAL, PORTS, ROOT, SERVICES, URLS } from './dev/local-config.mjs';
import { startKeycloak } from './dev/keycloak.mjs';
import { startPostgres } from './dev/postgres.mjs';

const args = process.argv.slice(2);
const colors = { postgres: 34, keycloak: 35, backend: 32, tooling: 33, xroad: 36, interface: 31 };
const logger = (name) => (message) => {
  for (const line of String(message).split('\n')) if (line.trim()) console.log(`\x1b[${colors[name] ?? 37}m[${name}]\x1b[0m ${line}`);
};

if (args.includes('--reset')) {
  for (const path of ['postgres', 'files', 'keys', join(`keycloak-${KEYCLOAK_VERSION}`, 'data')]) rmSync(join(LOCAL, path), { recursive: true, force: true });
  console.log('Données locales supprimées.');
  process.exit(0);
}

if (existsSync(join(ROOT, '.env'))) process.loadEnvFile(join(ROOT, '.env'));

mkdirSync(join(LOCAL, 'keys'), { recursive: true });
const signingKey = join(LOCAL, 'keys', 'backend-signing.pem');
if (!existsSync(signingKey)) {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  writeFileSync(signingKey, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
}
const sessionKey = join(LOCAL, 'keys', 'interface-session.key');
if (!existsSync(sessionKey)) writeFileSync(sessionKey, randomBytes(32).toString('base64url'), { mode: 0o600 });

const stops = [];
let stopping = false;
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const fn of stops.reverse()) await fn().catch(() => {});
  process.exit(code);
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());

const free = (port) => new Promise((resolve) => {
  const server = createServer().once('error', () => resolve(false)).once('listening', () => server.close(() => resolve(true)));
  server.listen(port, '127.0.0.1');
});
const wantedPorts = { postgres: PORTS.postgres, keycloak: PORTS.keycloak };
const busy = [];
for (const [name, port] of Object.entries(wantedPorts)) if (!(await free(port))) busy.push(`${name} (${port})`);
if (busy.length) {
  console.error(`Ports déjà utilisés : ${busy.join(', ')}. Arrêter l'autre processus ou une pile déjà lancée.`);
  process.exit(1);
}

try {
  stops.push(await startPostgres(logger('postgres')));
  stops.push(await startKeycloak(logger('keycloak')));
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Démarrage de l’infrastructure impossible (voir les messages ci-dessus).');
  await stop(1);
}

const workspace = (name) => {
  const service = SERVICES[name];
  const directory = { backend: 'apps/backend', tooling: 'apps/tooling', xroad: 'apps/xroad-sim', interface: 'apps/interface/web' }[name];
  const manifest = join(ROOT, directory, 'package.json');
  if (!existsSync(manifest)) return undefined;
  const json = JSON.parse(readFileSync(manifest, 'utf8'));
  return json.name === service.package && json.scripts?.dev ? directory : undefined;
};

const wanted = args.includes('--infra') ? [] : args.filter((arg) => !arg.startsWith('--'));
const names = wanted.length ? wanted : args.includes('--infra') ? [] : Object.keys(SERVICES);
for (const name of names) {
  if (!SERVICES[name]) {
    console.error(`Service inconnu : ${name} (attendu : ${Object.keys(SERVICES).join(', ')})`);
    await stop(1);
  }
  const directory = workspace(name);
  const log = logger(name);
  if (!directory) {
    log(`pas encore de script dev dans le paquet ${SERVICES[name].package} : non lancé`);
    continue;
  }
  const child = spawn(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', ['run', 'dev'], {
    cwd: join(ROOT, directory),
    env: { ...process.env, ...SERVICES[name].env, NODE_ENV: 'development' },
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
  });
  child.stdout.on('data', log);
  child.stderr.on('data', log);
  child.on('exit', (code) => {
    if (!stopping) log(`arrêté (code ${code})`);
  });
  stops.push(() => new Promise((resolve) => {
    if (child.exitCode !== null) return resolve();
    child.once('exit', resolve);
    child.kill('SIGTERM');
  }));
}

console.log(`
Pile locale prête. Comptes de démo (mot de passe demo-2026) :
  usager        aminata.usager
  agents        agent.justice · admin.justice · agent.enseignement · agent.anip · super.admin
  opérateur     operateur
Interface ${URLS.interface} · Backend ${URLS.backend} · Tooling ${URLS.tooling} · X-Road ${URLS.xroad} · Keycloak ${URLS.keycloak}
Ctrl+C pour tout arrêter.`);
