import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {isolatedDatabase} from './helpers.mjs';
import {database,migrate,provision} from '../dist/apps/backend/src/database.js';
import {Conversations} from '../dist/apps/backend/src/conversations.js';
import {Agent} from '../dist/apps/backend/src/agent.js';
import {HttpModels} from '../dist/apps/backend/src/model.js';
import {identifier} from '../dist/apps/backend/src/domain.js';
import {DiagnosticProblem,describeError} from '../dist/apps/backend/src/diagnostics.js';
const configuration={id:'primary',label:'Test',baseUrl:'http://127.0.0.1:9/v1',protocol:'chat-completions',model:'test-model',apiKeyRef:'TEST_KEY',temperature:0.2,active:true};
const trace='00-12345678901234567890123456789012-1234567890123456-01';

test('Provider errors retain HTTP diagnostics without persisting prompts, keys or raw provider messages',async()=>{
 const server=http.createServer((_req,res)=>{
  res.writeHead(403,{'Content-Type':'application/json','x-request-id':'upstream-test-001'});
  res.end(JSON.stringify({error:{message:'Access denied. Please check your network settings. PRIVATE_PROMPT secret-key-test',code:'forbidden'}}));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try {
  const baseUrl=`http://127.0.0.1:${server.address().port}/v1`;
  const models=new HttpModels({synthetic:{baseUrl:baseUrl+'/',protocol:'chat-completions',apiKeyEnv:'TEST_KEY'}},{TEST_KEY:'secret-key-test'});
  await assert.rejects(models.generate({...configuration,baseUrl},[{role:'user',content:'PRIVATE_PROMPT'}],[]),error=>{
   const diagnostic=describeError(error);
   assert.equal(diagnostic.upstreamStatus,403);
   assert.equal(diagnostic.upstreamRequestId,'upstream-test-001');
   assert.equal(diagnostic.reason,'provider_network_access_denied');
   assert.equal(diagnostic.provider,new URL(baseUrl).host);
   assert.doesNotMatch(JSON.stringify(diagnostic),/PRIVATE_PROMPT|secret-key-test/);
   return true;
  });
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

test('Failed processing is traceable and its cause survives retry exhaustion',async()=>{
 const pg=await isolatedDatabase();const pool=database(pg.connection);
 const previousError=console.error;const logs=[];
 console.error=(line)=>logs.push(String(line));
 try {
  await migrate(pool);await provision(pool,'global','models',configuration);
  const conversations=new Conversations(pool);
  const user={userRef:identifier('usr'),administrationId:'global',channel:'web',expiresAt:Date.now()+3600000};
  const conversation=await conversations.create(user,{locale:'fr'},'diagnostic-create-001');
  const input={id:identifier('msg'),content:{type:'text',text:'PRIVATE_PROMPT'},sentAt:new Date().toISOString()};
  await conversations.accept(user,conversation.id,input,'diagnostic-message-001',trace);
  const failure=new DiagnosticProblem('Appel au fournisseur IA refusé (HTTP 403).',{stage:'model.response',provider:'synthetic',model:'test-model',upstreamStatus:403,reason:'provider_network_access_denied'});
  const agent=new Agent(pool,conversations,{async generate(){throw failure;}},{async discover(){return[];},async call(){throw new Error('Unexpected tool');}});
  await assert.rejects(agent.process(conversation.id));
  const before=(await pool.query('SELECT attempts,last_error FROM backend_messages WHERE id=$1',[input.id])).rows[0];
  const diagnostic=JSON.parse(before.last_error);
  assert.equal(before.attempts,1);assert.equal(diagnostic.upstreamStatus,403);
  assert.equal(diagnostic.messageId,input.id);assert.equal(diagnostic.traceId,trace.split('-')[1]);
  await pool.query('UPDATE backend_messages SET attempts=12 WHERE id=$1',[input.id]);
  await agent.process(conversation.id);
  const after=(await pool.query('SELECT processed_at,last_error FROM backend_messages WHERE id=$1',[input.id])).rows[0];
  assert.ok(after.processed_at);assert.equal(after.last_error,before.last_error);
  assert.ok(logs.some(line=>JSON.parse(line).event==='agent.processing_failed'));
  assert.ok(logs.some(line=>JSON.parse(line).event==='agent.processing_exhausted'));
  assert.doesNotMatch(logs.join('\n'),/PRIVATE_PROMPT/);
 }finally{console.error=previousError;await pool.end();await pg.close();}
});
