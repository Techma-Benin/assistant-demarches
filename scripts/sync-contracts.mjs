// Copies the shared schemas each contract uses from domain.schema.json into that contract.
// Usage: node scripts/sync-contracts.mjs [--check]
import fs from 'node:fs';
import { CONTRACTS, load } from './lib.mjs';

const check = process.argv.includes('--check');
const domain = load('domain.schema.json');
const manifest = load('manifest.json');

function closure(root, prefix) {
  const names = new Set();
  const visit = (value) => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== 'object') return;
    const target = typeof value.$ref === 'string' ? [prefix, '#/$defs/'].find((p) => value.$ref.startsWith(p)) : undefined;
    if (target) {
      const name = value.$ref.slice(target.length);
      if (!domain.$defs[name]) throw new Error(`Schéma partagé inconnu : ${name}`);
      if (!names.has(name)) {
        names.add(name);
        visit(domain.$defs[name]);
      }
    }
    Object.values(value).forEach(visit);
  };
  visit(root);
  return [...names].sort();
}

const rewrite = (schema, prefix) => JSON.parse(JSON.stringify(schema).replaceAll('"#/$defs/', `"${prefix}`));

let stale = [];
for (const file of manifest.documents.filter((name) => name !== 'domain.schema.json')) {
  const document = load(file);
  if (file.endsWith('.openapi.json')) {
    const prefix = '#/components/schemas/';
    const names = closure({ paths: document.paths }, prefix);
    const schemas = Object.fromEntries(names.map((name) => [name, rewrite(domain.$defs[name], prefix)]));
    document.components = { ...document.components, schemas };
  } else {
    const names = closure({ tools: document.tools }, '#/$defs/');
    document.$defs = Object.fromEntries(names.map((name) => [name, domain.$defs[name]]));
  }
  const next = JSON.stringify(document, null, 2) + '\n';
  const target = new URL(file, CONTRACTS);
  if (fs.readFileSync(target, 'utf8') !== next) {
    stale.push(file);
    if (!check) fs.writeFileSync(target, next);
  }
}
if (check && stale.length) {
  console.error(`Schémas partagés non synchronisés : ${stale.join(', ')}. Lancer pnpm contracts:sync.`);
  process.exit(1);
}
console.log(check ? 'Schémas partagés synchronisés.' : `Synchronisé : ${stale.length ? stale.join(', ') : 'rien à changer'}.`);
