// In a pull request: any change under contracts/ must raise the manifest version.
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { load } from './lib.mjs';

const base = process.env.BASE_SHA;
if (!base || !/^[a-f0-9]{40}$/.test(base)) throw new Error('BASE_SHA requis');
const changed = execFileSync('git', ['diff', '--name-only', base, 'HEAD', '--', 'contracts/'], { encoding: 'utf8' }).trim();
if (!changed) process.exit(0);

let previous;
try {
  previous = JSON.parse(execFileSync('git', ['show', `${base}:contracts/v2/manifest.json`], { encoding: 'utf8' }));
} catch {
  console.log('Première introduction des contrats v2.');
  process.exit(0);
}
const parse = (version) => {
  assert.match(version, /^\d+\.\d+\.\d+$/);
  return version.split('.').map(Number);
};
const before = parse(previous.version);
const after = parse(load('manifest.json').version);
assert.ok(
  after.some((value, index) => value > before[index] && after.slice(0, index).every((v, j) => v === before[j])),
  'Augmenter la version de contracts/v2/manifest.json (et info.version des OpenAPI) avant de modifier le contrat.',
);
console.log(`Contrat modifié (${previous.version} → ${after.join('.')}) : revue des trois équipes requise.`);
