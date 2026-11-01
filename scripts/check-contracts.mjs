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
const inline=s=>JSON.parse(JSON.stringify(s),(k,v)=>v&&typeof v.$ref==='string'&&v.$ref.startsWith('#/$defs/')?inline(domain.$defs[v.$ref.slice(8)]):v);
const tool=name=>catalog.tools.find(t=>t.name===name);
assert.deepEqual(tool('procedures.search').outputSchema.properties.items.items,inline(domain.$defs.Procedure),'procedures.search embarque Procedure');
assert.deepEqual(tool('procedures.get').outputSchema,inline(domain.$defs.Procedure),'procedures.get embarque Procedure');
const fixtures=load('mocks/fixtures.json');
for(const [name,value] of Object.entries(fixtures.schemas)) valid(name,value);
validateEvent(fixtures.event);
assert.throws(()=>valid('Case',{...fixtures.schemas.Case,simulated:false}),'dossier sans marque de simulation');
assert.throws(()=>valid('Case',{...fixtures.schemas.Case,status:'awaiting_applicant'}),'état de dossier hors contrat');
assert.throws(()=>valid('OfficialAssignment',{administrationId:'justice',role:'chef'}),'rôle inconnu');
for(const t of catalog.tools){const f=fixtures.tools[t.name];assert.ok(f,t.name);assert.ok(ajv.compile(t.inputSchema)(f.input),t.name+' input');assert.ok(ajv.compile(t.outputSchema)(f.output),t.name+' output');}
console.log(`Contrats valides : ${Object.keys(domain.$defs).length} schémas, ${operationIds.size} opérations HTTP, ${catalog.tools.length} outils MCP et exemples.`);
