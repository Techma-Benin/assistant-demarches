import { spawn, execFileSync } from 'node:child_process';
import { copyFileSync, createWriteStream, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { JAVA_VERSION, KEYCLOAK_VERSION, LOCAL, PORTS, PREVIEW_DOMAIN, ROOT, URLS } from './local-config.mjs';

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
export async function prepareKeycloak(log, local = LOCAL) {
  const javaDir = `${local}java`;
  mkdirSync(local, { recursive: true });
  if (!installed(javaDir)) {
    let reuse = false;
    try {
      const home = findJavaHome(javaDir);
      execFileSync(join(home, 'bin', windows ? 'java.exe' : 'java'), ['-version'], { stdio: 'ignore' });
      writeFileSync(join(javaDir, INSTALLED), '');
      reuse = true;
      log('JRE déjà présent dans .local/java : marqueur .installed posé, téléchargement ignoré.');
    } catch { /* missing or broken JRE: download below */ }
    if (!reuse) {
      const os = windows ? 'windows' : process.platform === 'darwin' ? 'mac' : 'linux';
      const arch = process.arch === 'arm64' ? 'aarch64' : 'x64';
      const archive = `${local}java-download${windows ? '.zip' : '.tar.gz'}`;
      await download(`https://api.adoptium.net/v3/binary/latest/${JAVA_VERSION}/ga/${os}/${arch}/jre/hotspot/normal/eclipse`, archive, log);
      extract(archive, javaDir);
      rmSync(archive);
    }
  }
  const keycloakDir = `${local}keycloak-${KEYCLOAK_VERSION}`;
  if (!installed(keycloakDir)) {
    const archive = `${local}keycloak-download.tar.gz`;
    await download(`https://github.com/keycloak/keycloak/releases/download/${KEYCLOAK_VERSION}/keycloak-${KEYCLOAK_VERSION}.tar.gz`, archive, log);
    extract(archive, keycloakDir, 1);
    rmSync(archive);
  }
  return { javaHome: findJavaHome(javaDir), keycloakDir };
}

export async function waitForRealm(child, urls, {
  timeoutMs = 180_000, requestTimeoutMs = 2000, pollIntervalMs = 1000,
} = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode != null) throw new Error('Keycloak s’est arrêté au démarrage.');
    try {
      const response = await fetch(`${urls.issuerInternal}/.well-known/openid-configuration`, {
        signal: AbortSignal.timeout(Math.max(1, Math.min(requestTimeoutMs, deadline - Date.now()))),
      });
      if (response.ok) return;
    } catch {}
    const remaining = deadline - Date.now();
    if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, Math.min(pollIntervalMs, remaining)));
  }
  throw new Error(`Keycloak n’a pas répondu en ${Math.ceil(timeoutMs / 1000)} secondes.`);
}

async function configurePreviewClient(urls, enabled) {
  if (!enabled) return;

  const tokenResponse = await fetch(`${urls.keycloak}/realms/master/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'password',
      client_id: 'admin-cli',
      username: 'admin',
      password: 'admin',
    }),
  });
  if (!tokenResponse.ok) throw new Error('Impossible de configurer le client Keycloak pour le domaine Replit.');
  const { access_token: token } = await tokenResponse.json();
  if (!token) throw new Error('Réponse admin Keycloak invalide.');

  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const clientResponse = await fetch(`${urls.keycloak}/admin/realms/techma/clients?clientId=interface`, { headers });
  if (!clientResponse.ok) throw new Error('Impossible de lire le client d’interface Keycloak.');
  const [client] = await clientResponse.json();
  if (!client?.id) throw new Error('Client d’interface introuvable dans Keycloak.');

  const redirectUris = new Set(client.redirectUris ?? []);
  redirectUris.add(`${urls.interface}/*`);
  const webOrigins = new Set(client.webOrigins ?? []);
  webOrigins.add(urls.interface);
  const logoutUris = new Set((client.attributes?.['post.logout.redirect.uris'] ?? '').split('##').filter(Boolean));
  logoutUris.add(`${urls.interface}/*`);
  const updateResponse = await fetch(`${urls.keycloak}/admin/realms/techma/clients/${encodeURIComponent(client.id)}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      ...client,
      redirectUris: [...redirectUris],
      webOrigins: [...webOrigins],
      attributes: {
        ...client.attributes,
        'post.logout.redirect.uris': [...logoutUris].join('##'),
      },
    }),
  });
  if (!updateResponse.ok) throw new Error('Impossible d’enregistrer les URL de l’aperçu dans Keycloak.');
}

export async function startKeycloak(log, {
  local = LOCAL, ports = PORTS, urls = URLS, publicDomain = PREVIEW_DOMAIN,
  productionDatabase, startupTimeoutMs = 180_000, streamLogs = false, onProcess,
} = {}) {
  mkdirSync(local, { recursive: true });
  const { javaHome, keycloakDir } = await prepareKeycloak(log, local);
  mkdirSync(join(keycloakDir, 'data', 'import'), { recursive: true });
  copyFileSync(join(ROOT, 'infra', 'keycloak', 'realm-techma.json'), join(keycloakDir, 'data', 'import', 'realm-techma.json'));
  const executable = join(keycloakDir, 'bin', windows ? 'kc.bat' : 'kc.sh');
  const child = spawn(executable, [
    ...(productionDatabase ? [
      'start', '--optimized', '--http-enabled=true',
      `--db-url=${productionDatabase.url}`,
      `--db-username=${productionDatabase.user}`,
      `--db-password=${productionDatabase.password}`,
    ] : ['start-dev']),
    `--http-port=${ports.keycloak}`,
    '--http-host=127.0.0.1',
    ...(publicDomain ? [`--hostname=${urls.keycloakPublic}`, '--proxy-headers=xforwarded'] : []),
    '--import-realm',
  ], {
    env: { ...process.env, JAVA_HOME: javaHome, KC_BOOTSTRAP_ADMIN_USERNAME: 'admin', KC_BOOTSTRAP_ADMIN_PASSWORD: 'admin' },
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: windows,
  });
  onProcess?.(child);
  const lines = [];
  for (const stream of [child.stdout, child.stderr]) stream.on('data', (chunk) => {
    if (streamLogs) log(String(chunk));
    else {
      lines.push(...String(chunk).split('\n'));
      if (lines.length > 30) lines.splice(0, lines.length - 30);
    }
  });
  try {
    await waitForRealm(child, urls, { timeoutMs: startupTimeoutMs });
    await configurePreviewClient(urls, Boolean(publicDomain));
  } catch (error) {
    if (!streamLogs) log(lines.join('\n'));
    child.kill('SIGTERM');
    throw error;
  }
  log(`prêt sur ${urls.keycloak} (realm techma, console admin/admin)`);
  return () => new Promise((resolve) => {
    if (child.exitCode !== null) return resolve();
    child.once('exit', resolve);
    child.kill('SIGTERM');
  });
}
