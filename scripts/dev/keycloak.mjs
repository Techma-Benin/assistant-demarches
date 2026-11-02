import { spawn, execFileSync } from 'node:child_process';
import { copyFileSync, createWriteStream, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { JAVA_VERSION, KEYCLOAK_VERSION, LOCAL, PORTS, ROOT, URLS } from './local-config.mjs';

const windows = process.platform === 'win32';

async function download(url, target, log) {
  log(`téléchargement de ${url}`);
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok || !response.body) throw new Error(`Téléchargement impossible (${response.status}) : ${url}`);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(target));
}

/** Windows 10+ ships a tar that extracts .zip. Named in full: the GNU tar of Git Bash, first in its PATH, cannot. */
const TAR = windows ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar';

const INSTALLED = '.installed';
const installed = (directory) => existsSync(join(directory, INSTALLED));

/**
 * Extracts in place, then writes a mark: an interrupted extraction must not look like an installation.
 * No rename into place: on Windows the antivirus keeps fresh files open for minutes, and the rename fails with EPERM.
 */
function extract(archive, target, stripComponents = 0) {
  rmSync(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
  mkdirSync(target, { recursive: true });
  execFileSync(TAR, ['-xf', archive, '-C', target, ...(stripComponents ? [`--strip-components=${stripComponents}`] : [])], { stdio: 'ignore' });
  writeFileSync(join(target, INSTALLED), '');
}

function findJavaHome(directory) {
  for (const entry of readdirSync(directory)) {
    for (const candidate of [join(directory, entry), join(directory, entry, 'Contents', 'Home')]) {
      if (existsSync(join(candidate, 'bin', windows ? 'java.exe' : 'java'))) return candidate;
    }
  }
  throw new Error(`Java introuvable dans ${directory}`);
}

/** Downloads a portable Java runtime and Keycloak once into .local/, so no system installation is needed. */
async function install(log) {
  const javaDir = `${LOCAL}java`;
  if (!installed(javaDir)) {
    const os = windows ? 'windows' : process.platform === 'darwin' ? 'mac' : 'linux';
    const arch = process.arch === 'arm64' ? 'aarch64' : 'x64';
    const archive = `${LOCAL}java-download${windows ? '.zip' : '.tar.gz'}`;
    await download(`https://api.adoptium.net/v3/binary/latest/${JAVA_VERSION}/ga/${os}/${arch}/jre/hotspot/normal/eclipse`, archive, log);
    extract(archive, javaDir);
    rmSync(archive);
  }
  const keycloakDir = `${LOCAL}keycloak-${KEYCLOAK_VERSION}`;
  if (!installed(keycloakDir)) {
    const archive = `${LOCAL}keycloak-download.tar.gz`;
    await download(`https://github.com/keycloak/keycloak/releases/download/${KEYCLOAK_VERSION}/keycloak-${KEYCLOAK_VERSION}.tar.gz`, archive, log);
    extract(archive, keycloakDir, 1);
    rmSync(archive);
  }
  return { javaHome: findJavaHome(javaDir), keycloakDir };
}

async function waitForRealm(child) {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error('Keycloak s’est arrêté au démarrage.');
    try {
      const response = await fetch(`${URLS.issuer}/.well-known/openid-configuration`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error('Keycloak n’a pas répondu en 3 minutes.');
}

export async function startKeycloak(log) {
  mkdirSync(LOCAL, { recursive: true });
  const { javaHome, keycloakDir } = await install(log);
  mkdirSync(join(keycloakDir, 'data', 'import'), { recursive: true });
  copyFileSync(join(ROOT, 'infra', 'keycloak', 'realm-techma.json'), join(keycloakDir, 'data', 'import', 'realm-techma.json'));
  const executable = join(keycloakDir, 'bin', windows ? 'kc.bat' : 'kc.sh');
  const child = spawn(executable, ['start-dev', `--http-port=${PORTS.keycloak}`, '--http-host=127.0.0.1', '--import-realm'], {
    env: { ...process.env, JAVA_HOME: javaHome, KC_BOOTSTRAP_ADMIN_USERNAME: 'admin', KC_BOOTSTRAP_ADMIN_PASSWORD: 'admin' },
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: windows,
  });
  const lines = [];
  for (const stream of [child.stdout, child.stderr]) stream.on('data', (chunk) => lines.push(...String(chunk).split('\n').slice(-20)));
  try {
    await waitForRealm(child);
  } catch (error) {
    log(lines.slice(-30).join('\n'));
    throw error;
  }
  log(`prêt sur ${URLS.keycloak} (realm techma, console admin/admin)`);
  return () => new Promise((resolve) => {
    if (child.exitCode !== null) return resolve();
    child.once('exit', resolve);
    child.kill('SIGTERM');
  });
}
