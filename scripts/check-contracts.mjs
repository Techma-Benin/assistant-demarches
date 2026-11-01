import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import SwaggerParser from '@apidevtools/swagger-parser';
import { ajv, load, domain, catalog, valid, validateEvent } from './lib.mjs';

execFileSync(process.execPath, [fileURLToPath(new URL('./sync-contracts.mjs', import.meta.url)), '--check'], { stdio: 'inherit' });

for (const name of Object.keys(domain.$defs)) assert.ok(ajv.getSchema(`${domain.$id}#/$defs/${name}`), name);

const manifest = load('manifest.json');
const operationIds = new Set();
for (const file of manifest.documents.filter((name) => name.endsWith('.openapi.json'))) {
  const api = load(file);
  assert.equal(api.info.version, manifest.version, `${file} : version différente du manifeste`);
  await SwaggerParser.validate(structuredClone(api));
  for (const methods of Object.values(api.paths)) {
    for (const operation of Object.values(methods)) {
      assert.ok(!operationIds.has(operation.operationId), `operationId en double : ${operation.operationId}`);
      operationIds.add(operation.operationId);
    }
  }
}

const compileTool = (schema) => ajv.compile({ ...schema, $defs: catalog.$defs });
for (const tool of catalog.tools) {
  compileTool(tool.inputSchema);
  compileTool(tool.outputSchema);
  assert.equal(tool.annotations.readOnlyHint, !tool._meta['bj.techma/requiresMandate'], `${tool.name} : readOnlyHint incohérent`);
}

const examples = load('examples.json');
for (const [name, value] of Object.entries(examples.schemas)) valid(name, value);
for (const event of examples.events) validateEvent(event);
for (const tool of catalog.tools) {
  const example = examples.tools[tool.name];
  assert.ok(example, `exemple manquant pour ${tool.name}`);
  const validate = compileTool(tool.inputSchema);
  assert.ok(validate(example.input), `${tool.name} : ${ajv.errorsText(validate.errors)}`);
}

assert.throws(() => valid('Case', { ...examples.schemas.Case, simulated: false }), 'un dossier doit être marqué simulé');
assert.throws(() => valid('Case', { ...examples.schemas.Case, status: 'processing' }), 'état de dossier hors contrat');
assert.throws(() => valid('Official', { ...examples.schemas.Official, role: 'chef' }), 'rôle inconnu');
assert.throws(() => valid('Procedure', { ...examples.schemas.Procedure, id: 'demo-procedure' }), 'fiche non officielle');

console.log(`Contrats ${manifest.version} valides : ${Object.keys(domain.$defs).length} schémas, ${operationIds.size} opérations HTTP, ${catalog.tools.length} outils MCP.`);
