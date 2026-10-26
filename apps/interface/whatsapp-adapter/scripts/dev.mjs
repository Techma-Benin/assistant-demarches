// Lance tsc en mode watch et redémarre node à chaque changement de dist/.
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const tsc = fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url));
const build = spawnSync(process.execPath, [tsc, '-p', 'tsconfig.build.json'], { stdio: 'inherit' });
if (build.status !== 0) process.exit(build.status ?? 1);

const children = [
  spawn(process.execPath, [tsc, '-p', 'tsconfig.build.json', '--watch', '--preserveWatchOutput'], { stdio: 'inherit' }),
  spawn(process.execPath, ['--watch', 'dist/main.js'], { stdio: 'inherit' }),
];
const stop = () => children.forEach((c) => c.kill());
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => { stop(); process.exit(0); });
children[1].on('exit', (code) => { stop(); process.exit(code ?? 0); });
