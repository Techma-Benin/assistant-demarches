import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

function walk(dir: string, files: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, files);
    else if (path.endsWith('.ts')) files.push(path);
  }
  return files;
}

test('code applicatif tooling : pas de table ni d’événement v1', () => {
  const src = join(dirname(fileURLToPath(import.meta.url)), '../../src');
  const forbidden = /request\.created|request\.status_changed|awaiting_user_validation|bj\.techma\.[a-z0-9_.]+\.v1/;
  for (const file of walk(src)) {
    if (file.includes(`${join('database', 'migrations')}.ts`) || file.includes(`${join('database', 'migrations')}`)) continue;
    const text = readFileSync(file, 'utf8');
    assert.equal(forbidden.test(text), false, file);
  }
});
