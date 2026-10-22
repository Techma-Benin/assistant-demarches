import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import http from 'node:http';
import {once} from 'node:events';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {WebSocket} from 'ws';
import {startMocks} from '../mocks/server.mjs';
import {valid,validateEvent,load,ajv,catalog} from '../scripts/lib.mjs';
const tp='00-'+('1'.repeat(32))+'-'+('2'.repeat(16))+'-01';
const uid=load('mocks/fixtures.json').schemas.Request.userRef;
const mid='msg_'+('0'.repeat(25))+'1';
async function environment(t){
 const external=process.env.BACKEND_UNDER_TEST||process.env.TOOLING_UNDER_TEST;
 if(external){assert.ok(process.env.BACKEND_UNDER_TEST&&process.env.TOOLING_UNDER_TEST,'Fournir les deux URL');return {backendUrl:process.env.BACKEND_UNDER_TEST,toolingUrl:process.env.TOOLING_UNDER_TEST};}
 const env=await startMocks({backendPort:0,toolingPort:0});t.after(()=>env.close());return env;
}
async function httpCall(env,path,{method='GET',body,token='mock-user',key=randomUUID(),extra={}}={}){
 const binary=body instanceof Uint8Array;const res=await fetch(env.backendUrl+path,{method,headers:{Authorization:'Bearer '+token,traceparent:tp,'Idempotency-Key':key,...(body?{'Content-Type':binary?'application/octet-stream':'application/json'}:{}),...extra},body:body?(binary?body:JSON.stringify(body)):undefined});
 const value=await res.json();if(!res.ok)valid('Problem',value);return {status:res.status,value};
}
async function conversation(env){const r=await httpCall(env,'/v1/conversations',{method:'POST',body:{channel:'web',locale:'fr'}});assert.equal(r.status,201);valid('Conversation',r.value);return r.value;}
async function callTool(env,c,name,args,{mandateId,key=randomUUID(),token='mock-agent'}={}){
 const client=new Client({name:'contract-test',version:'1.0.0'});const transport=new StreamableHTTPClientTransport(new URL(env.toolingUrl+'/mcp'),{requestInit:{headers:{Authorization:'Bearer '+token,traceparent:tp,'X-Conversation-Id':c.id,'X-User-Ref':c.userRef,'Idempotency-Key':key,...(mandateId?{'X-Mandate-Id':mandateId}:{})}}});
 try{await client.connect(transport);const out=await client.callTool({name,arguments:args});if(!out.isError){const tool=catalog.tools.find(t=>t.name===name);assert.ok(ajv.compile(tool.outputSchema)(out.structuredContent),name+' output conforme');}return out;}finally{await client.close();}
}
async function mandate(env,c,scopes=['requests:write','documents:write','requests:submit']){const p='/v1/conversations/'+c.id;const challenge=await httpCall(env,p+'/mandate-challenges',{method:'POST',body:{procedureId:'demo-procedure',scopes}});assert.equal(challenge.status,201);valid('Challenge',challenge.value);const result=await httpCall(env,p+'/mandates',{method:'POST',body:{challengeId:challenge.value.id,accepted:true}});assert.equal(result.status,201);valid('Mandate',result.value);return result.value;}
test('C1 : identité, formats stricts, isolation, déduplication et erreurs',async t=>{
 const env=await environment(t),c=await conversation(env),path='/v1/conversations/'+c.id+'/messages';
 const body={id:mid,content:{type:'text',text:'Bonjour'},sentAt:new Date().toISOString()},key=randomUUID();
 const first=await httpCall(env,path,{method:'POST',body,key});assert.equal(first.status,202);valid('MessageAccepted',first.value);
 assert.deepEqual(await httpCall(env,path,{method:'POST',body,key}),first);
 assert.equal((await httpCall(env,path,{method:'POST',body:{...body,content:{type:'text',text:'Différent'}},key})).status,409);
 assert.equal((await httpCall(env,path,{method:'POST',body:{...body,userRef:uid}})).status,400);
 const events=await httpCall(env,'/v1/conversations/'+c.id+'/events');valid('EventPage',events.value);assert.equal(events.value.items.filter(e=>e.data.kind==='message.sent').length,1);events.value.items.forEach(validateEvent);
 assert.equal((await httpCall(env,'/v1/conversations/'+c.id+'/events',{token:'mock-user-2'})).status,404);
 assert.equal((await httpCall(env,'/v1/admin/metrics')).status,403);
 assert.equal((await httpCall(env,'/v1/admin/metrics',{token:'invalid'})).status,401);
 assert.equal((await httpCall(env,'/v1/conversations/'+c.id+'/events?cursor=unknown')).status,410);
});
test('C1 + C2 : parcours consentement → demande → pièce → lien, puis révocation',async t=>{
 const env=await environment(t),c=await conversation(env);
 let out=await callTool(env,c,'request.create',{procedureId:'demo-procedure'});assert.ok(out.isError);assert.equal(JSON.parse(out.content[0].text).code,'MANDATE_MISSING');
 const m=await mandate(env,c),options={mandateId:m.id};
 out=await callTool(env,c,'procedures.search',{query:'demo',locale:'fr'});assert.equal(out.structuredContent.items.length,1);
 out=await callTool(env,c,'procedures.get',{procedureId:'demo-procedure'});valid('Procedure',out.structuredContent);
 const key=randomUUID();out=await callTool(env,c,'request.create',{procedureId:'demo-procedure'},{...options,key});assert.ok(!out.isError);let r=out.structuredContent;valid('Request',r);
 const again=await callTool(env,c,'request.create',{procedureId:'demo-procedure'},{...options,key});assert.equal(again.structuredContent.id,r.id);
 out=await callTool(env,c,'request.submit',{requestId:r.id},options);assert.equal(JSON.parse(out.content[0].text).code,'REQUEST_INCOMPLETE');
 out=await callTool(env,c,'request.update',{requestId:r.id,fields:{npi:'must-not-pass'}},options);assert.ok(out.isError);
 out=await callTool(env,c,'request.update',{requestId:r.id,fields:{displayName:'Usager fictif'}},options);assert.ok(!out.isError);
 const file=await httpCall(env,'/v1/files',{method:'POST',body:new TextEncoder().encode('SYNTHETIC PDF'),extra:{'X-File-Mime-Type':'application/pdf'}});assert.equal(file.status,201);valid('File',file.value);
 out=await callTool(env,c,'documents.attach',{requestId:r.id,fileId:file.value.id,documentType:'demo-document'},options);assert.equal(out.structuredContent.status,'ready');
 out=await callTool(env,c,'documents.verify',{requestId:r.id,fileId:file.value.id});assert.equal(out.structuredContent.status,'valid');
 out=await callTool(env,c,'request.submit',{requestId:r.id},options);assert.equal(out.structuredContent.status,'awaiting_user_validation');assert.ok(out.structuredContent.officialLink);
 assert.equal((await httpCall(env,'/v1/requests/'+r.id)).status,200);
 const revoked=await httpCall(env,`/v1/conversations/${c.id}/mandates/${m.id}/revoke`,{method:'POST'});assert.equal(revoked.status,200);
 out=await callTool(env,c,'request.create',{procedureId:'demo-procedure'},options);assert.equal(JSON.parse(out.content[0].text).code,'MANDATE_REVOKED');
 out=await callTool(env,c,'request.status',{requestId:r.id});assert.ok(!out.isError);
 const other=await conversation(env);out=await callTool(env,other,'request.status',{requestId:r.id});assert.ok(out.isError);
});
test('C2 : mandat de portée limitée et séparation contrôle / agent',async t=>{
 const env=await environment(t),c=await conversation(env),m=await mandate(env,c,['requests:write']);
 const out=await callTool(env,c,'request.create',{procedureId:'demo-procedure'},{mandateId:m.id});assert.ok(!out.isError);
 const denied=await callTool(env,c,'request.submit',{requestId:out.structuredContent.id},{mandateId:m.id});assert.equal(JSON.parse(denied.content[0].text).code,'MANDATE_SCOPE_DENIED');
 const res=await fetch(env.toolingUrl+'/internal/v1/mandates',{method:'POST',headers:{Authorization:'Bearer mock-agent',traceparent:tp,'Idempotency-Key':randomUUID(),'Content-Type':'application/json'},body:'{}'});assert.equal(res.status,401);
});
test('C3 : pagination, modèle, outil, fiche et audit typés',async t=>{
 const env=await environment(t);for(const [r,n]of [['models','ModelConfigPage'],['tools','ToolConfigPage'],['procedures','ProcedurePage'],['conversations','ConversationPage'],['audit','AuditEntryPage']]){
  const list=await httpCall(env,'/v1/admin/'+r,{token:'mock-admin'});assert.equal(list.status,200);valid(n,list.value);
  if(['models','tools','procedures'].includes(r)){const item=list.value.items[0];const update=await httpCall(env,'/v1/admin/'+r+'/'+(item.id??item.name),{token:'mock-admin',method:'PUT',body:item});assert.equal(update.status,200);}
 }
 const metrics=await httpCall(env,'/v1/admin/metrics',{token:'mock-admin'});valid('Metrics',metrics.value);
 assert.equal((await httpCall(env,'/v1/admin/tools?limit=0',{token:'mock-admin'})).status,400);
});
test('C4 : ingestion authentifiée, enveloppe cohérente et déduplication',async t=>{
 const env=await environment(t),c=await conversation(env),f=load('mocks/fixtures.json'),event=structuredClone(f.event);event.source='urn:techma:tooling';event.data.conversationId=c.id;event.data.message.conversationId=c.id;
 const args={method:'POST',body:event,token:'mock-tooling-events'};
 assert.equal((await httpCall(env,'/internal/v1/events',args)).status,202);assert.equal((await httpCall(env,'/internal/v1/events',args)).status,202);
 const list=await httpCall(env,'/v1/conversations/'+c.id+'/events');assert.equal(list.value.items.length,1);
 assert.equal((await httpCall(env,'/internal/v1/events',{...args,body:{...event,type:'bj.techma.tool.called.v1'}})).status,400);
});
test('C1 WebSocket : ticket à usage unique et rejeu',async t=>{
 const env=await environment(t),c=await conversation(env),p='/v1/conversations/'+c.id;
 await httpCall(env,p+'/messages',{method:'POST',body:{id:mid,content:{type:'text',text:'Bonjour'},sentAt:new Date().toISOString()}});
 const ticket=await httpCall(env,p+'/socket-ticket',{method:'POST'});assert.equal(ticket.status,201);valid('SocketTicket',ticket.value);
 const ws=new WebSocket(ticket.value.url);t.after(()=>ws.terminate());const first=await once(ws,'message');const event=JSON.parse(first[0].toString());validateEvent(event);assert.equal(event.data.conversationId,c.id);ws.close();
 const reused=new WebSocket(ticket.value.url);const err=await once(reused,'error');assert.match(err[0].message,/401/);
});
test('C1 callback : récepteur de référence déduplique et acquitte 204',async t=>{
 const {startCallbackMock}=await import('../mocks/whatsapp-callback.mjs');const receiver=await startCallbackMock();t.after(()=>receiver.close());
 const e=load('mocks/fixtures.json').event;const headers={Authorization:'Bearer mock-backend-delivery',traceparent:tp,'Idempotency-Key':e.id,'Content-Type':'application/json'};
 for(let n=0;n<2;n++)assert.equal((await fetch(receiver.url+'/v1/callbacks/events',{method:'POST',headers,body:JSON.stringify(e)})).status,204);assert.equal(receiver.events.size,1);
});

test('C2 ressources : fiches et pièces privées Backend pour Tooling',async t=>{
 const env=await environment(t);
 const list=await httpCall(env,'/internal/v1/procedures?query=demo',{token:'mock-tooling-resources'});assert.equal(list.status,200);valid('ProcedurePage',list.value);
 const proc=await httpCall(env,'/internal/v1/procedures/demo-procedure',{token:'mock-tooling-resources'});assert.equal(proc.status,200);valid('Procedure',proc.value);
 const f=await httpCall(env,'/v1/files',{method:'POST',body:new TextEncoder().encode('demo'),extra:{'X-File-Mime-Type':'application/pdf'}});
 const access=await httpCall(env,'/internal/v1/files/'+f.value.id,{token:'mock-tooling-resources',extra:{'X-User-Ref':uid}});assert.equal(access.status,200);valid('FileAccess',access.value);
 assert.equal((await httpCall(env,'/internal/v1/files/'+f.value.id,{token:'mock-tooling-resources',extra:{'X-User-Ref':'usr_'+('0'.repeat(25))+'2'}})).status,404);
});
