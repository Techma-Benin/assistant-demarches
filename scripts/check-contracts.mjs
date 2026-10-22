import assert from 'node:assert/strict';
import SwaggerParser from '@apidevtools/swagger-parser';
import {ajv,load,domain,catalog,valid,validateEvent} from './lib.mjs';
for(const name of Object.keys(domain.$defs)) assert.ok(ajv.getSchema(domain.$id+'#/$defs/'+name),name);
const operationIds=new Set();
for(const file of load('contracts/manifest.json').documents.filter(f=>f.endsWith('.openapi.json'))){
 const api=load('contracts/'+file);
 for(const [n,s] of Object.entries(api.components.schemas)) assert.deepEqual(s,JSON.parse(JSON.stringify(domain.$defs[n]).replaceAll('#/$defs/','#/components/schemas/')),file+' shared '+n);
 await SwaggerParser.validate(structuredClone(api));
 for(const methods of Object.values(api.paths))for(const op of Object.values(methods)){
  assert.ok(!operationIds.has(op.operationId));operationIds.add(op.operationId);
 }
}
for(const t of catalog.tools){ajv.compile(t.inputSchema);ajv.compile(t.outputSchema);assert.equal(t.annotations.readOnlyHint,!t._meta['bj.techma/requiresMandate']);}
const fixtures=load('mocks/fixtures.json');
for(const [name,value] of Object.entries(fixtures.schemas)) valid(name,value);
validateEvent(fixtures.event);
for(const t of catalog.tools){const f=fixtures.tools[t.name];assert.ok(f,t.name);assert.ok(ajv.compile(t.inputSchema)(f.input),t.name+' input');assert.ok(ajv.compile(t.outputSchema)(f.output),t.name+' output');}
console.log(`Contrats valides : ${Object.keys(domain.$defs).length} schémas, ${operationIds.size} opérations HTTP, ${catalog.tools.length} outils MCP et exemples.`);
