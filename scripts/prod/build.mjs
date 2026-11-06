import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { prepareKeycloak } from '../dev/keycloak.mjs';
import { ROOT, RUNTIME } from './config.mjs';

const env = { ...process.env, NODE_ENV: 'production', SHOWCASE_PRODUCTION: '1', NEXT_TELEMETRY_DISABLED: '1' };
for (const name of ['@techma/backend', '@techma/tooling', '@techma/xroad-sim', '@techma/interface']) {
  execFileSync(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', ['--filter', name, 'build'], {
    cwd: ROOT, env, stdio: 'inherit', shell: process.platform === 'win32',
  });
}
// Download/prepare runtime dependencies during build, not during the startup health-check window.
const { javaHome, keycloakDir } = await prepareKeycloak(console.log, RUNTIME);
execFileSync(join(keycloakDir, 'bin', process.platform === 'win32' ? 'kc.bat' : 'kc.sh'), [
  'build', '--db=postgres',
], { env: { ...env, JAVA_HOME: javaHome }, stdio: 'inherit', shell: process.platform === 'win32' });
console.log('Showcase production build complete.');
