import { spawnSync } from 'node:child_process';
import { readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const report = join(tmpdir(), 'techma-pivot-checks-' + Date.now());
mkdirSync(report, { recursive: true });
const tests = (directory, suffix) => readdirSync(join(root, directory), { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? tests(directory + '/' + entry.name, suffix) : entry.name.endsWith(suffix) ? [directory + '/' + entry.name] : []);
const steps = [
  ['contracts', ['scripts/check-contracts.mjs']],
  ['generate-types', ['scripts/generate-types.mjs']],
  ['shared-types', ['node_modules/typescript/bin/tsc', '--noEmit']],
  ['build-backend', ['apps/backend/scripts/build.mjs']],
  ['build-tooling', ['apps/tooling/node_modules/typescript/bin/tsc', '-p', 'apps/tooling/tsconfig.json']],
  ['contract-tests', ['--test', ...tests('tests', '.test.mjs')]],
  ['backend-tests', ['--test', ...tests('apps/backend/tests', '.test.mjs').map(file => join(root, file))]],
  ['tooling-tests', () => ['--test', '--test-concurrency=1', '--enable-source-maps', ...tests('apps/tooling/dist/test', '.test.js').map(file => join(root, file))]],
  ['backend-tooling-integration', ['--env-file-if-exists=integration/.env', '--test', 'integration/backend-tooling.test.mjs']],
];
console.log('Reports: ' + report);
for (const [name, definition] of steps) {
  const args = typeof definition === 'function' ? definition() : definition;
  let temporaryDatabase, databaseOwner;
  const environment = {...process.env};
  let result;
  try {
    if (name === 'tooling-tests' && !environment.TEST_DATABASE_URL) {
      const {isolatedDatabase} = await import('../apps/backend/tests/helpers.mjs');
      const {database} = await import('../apps/backend/dist/apps/backend/src/database.js');
      temporaryDatabase = await isolatedDatabase();
      databaseOwner = database(temporaryDatabase.connection);
      const databaseName = 'pivot_tooling_' + randomBytes(8).toString('hex') + '_test';
      await databaseOwner.query('CREATE DATABASE ' + databaseName);
      const url = new URL(temporaryDatabase.connection);
      url.pathname = '/' + databaseName;
      url.searchParams.delete('options');
      environment.TEST_DATABASE_URL = url.href;
      temporaryDatabase.databaseName = databaseName;
    }
    result = spawnSync(process.execPath, args, { cwd: name === 'backend-tests' ? join(root, 'apps/backend') : name === 'tooling-tests' ? join(root, 'apps/tooling') : root, env: environment, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  } finally {
    if (temporaryDatabase) {
      try {
        if (temporaryDatabase.databaseName) await databaseOwner.query('DROP DATABASE IF EXISTS ' + temporaryDatabase.databaseName + ' WITH (FORCE)');
      } finally {
        await databaseOwner?.end();
        await temporaryDatabase.close();
      }
    }
  }
  const output = (result.stdout ?? '') + (result.stderr ?? '');
  writeFileSync(join(report, name + '.log'), output);
  console.log(name + ': ' + (result.status === 0 ? 'PASS' : 'FAIL'));
  console.log(output.split('\n').filter(line => /^# (tests|pass|fail|skipped)|^Contrats valides/.test(line)).join('\n'));
  if (result.status !== 0) {
    console.error(output.slice(-18000));
    process.exitCode = result.status ?? 1;
    break;
  }
}
