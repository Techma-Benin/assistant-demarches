// Generates packages/contracts-ts from contracts/v2. Never edit the generated files by hand.
import fs from 'node:fs/promises';
import openapiTS, { astToString } from 'openapi-typescript';
import { CONTRACTS, domain, load } from './lib.mjs';

const dir = new URL('../packages/contracts-ts/src/', import.meta.url);
await fs.rm(dir, { recursive: true, force: true });
await fs.mkdir(dir, { recursive: true });
const header = '// Généré par pnpm contracts:generate depuis contracts/v2. Ne pas modifier.\n';

// Every shared schema, as `components["schemas"]`.
const schemas = JSON.parse(JSON.stringify(domain.$defs).replaceAll('"#/$defs/', '"#/components/schemas/'));
const shared = await openapiTS({ openapi: '3.1.0', info: { title: 'domain', version: load('manifest.json').version }, paths: {}, components: { schemas } });
await fs.writeFile(new URL('schemas.ts', dir), header + astToString(shared));

const apis = [
  ['conversation', 'ConversationPaths'],
  ['admin', 'AdminPaths'],
  ['operator', 'OperatorPaths'],
  ['backend-internal', 'BackendInternalPaths'],
  ['tooling-internal', 'ToolingInternalPaths'],
  ['xroad', 'XroadPaths'],
];
for (const [name] of apis) {
  const ast = await openapiTS(new URL(`${name}.openapi.json`, CONTRACTS));
  await fs.writeFile(new URL(`${name}.ts`, dir), header + astToString(ast));
}
await fs.writeFile(
  new URL('index.ts', dir),
  header +
    `export type { components } from './schemas.js';\n` +
    `export type Schemas = import('./schemas.js').components['schemas'];\n` +
    apis.map(([name, alias]) => `export type { paths as ${alias} } from './${name}.js';\n`).join(''),
);
console.log(`Types générés pour ${apis.length} API et ${Object.keys(domain.$defs).length} schémas.`);
