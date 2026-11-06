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

const configuration={id:'primary',label:'Test',baseUrl:'http://127.0.0.1:9/v1',protocol:'responses',model:'test-model',apiKeyRef:'TEST_KEY',temperature:0.2,active:true};
const trace='00-12345678901234567890123456789012-1234567890123456-01';
const tooling={async discover(){return[];},async call(){throw new Error('Unexpected tool');}};

async function conversationWith(pool,text){
 const conversations=new Conversations(pool);
 const user={userRef:identifier('usr'),administrationId:'global',channel:'web',expiresAt:Date.now()+3600000};
 const conversation=await conversations.create(user,{locale:'fr'},identifier('idem'));
 const input={id:identifier('msg'),content:{type:'text',text},sentAt:new Date().toISOString()};
 await conversations.accept(user,conversation.id,input,identifier('idem'),trace);
 return {conversations,conversation,input};
}

function captured(){
 const previous={error:console.error,log:console.log};const lines=[];
 const keep=(line)=>{try{lines.push(JSON.parse(String(line)));}catch{}};
 console.error=keep;console.log=keep;
 return {lines,restore(){console.error=previous.error;console.log=previous.log;}};
}

test('A refused request names the refused field and what was asked, without any provider text',async()=>{
 const server=http.createServer((_req,res)=>{
  res.writeHead(400,{'Content-Type':'application/json','x-request-id':'upstream-test-002'});
  res.end(JSON.stringify({error:{message:'Unsupported parameter: tools is not supported with this model. PRIVATE_PROMPT secret-key-test',type:'invalid_request_error',param:'tools',code:'unsupported_parameter'}}));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try {
  const baseUrl=`http://127.0.0.1:${server.address().port}/v1`;
  const models=new HttpModels({},{TEST_KEY:'secret-key-test'});
  const tool={name:'procedures.search',description:'x',inputSchema:{type:'object',properties:{}}};
  await assert.rejects(models.generate({...configuration,baseUrl},[{role:'user',content:'PRIVATE_PROMPT'}],[tool]),error=>{
   const diagnostic=describeError(error);
   assert.equal(diagnostic.upstreamStatus,400);
   assert.equal(diagnostic.upstreamCode,'unsupported_parameter');
   assert.equal(diagnostic.upstreamParam,'tools');
   assert.equal(diagnostic.upstreamHint,'unsupported_parameter_for_model');
   assert.equal(diagnostic.reason,'provider_request_rejected','existing fallbacks key on this reason');
   assert.equal(diagnostic.protocol,'responses');
   assert.equal(diagnostic.endpoint,'responses');
   assert.equal(diagnostic.configId,'primary');
   assert.equal(diagnostic.tools,1);
   assert.equal(diagnostic.turns,1);
   assert.doesNotMatch(JSON.stringify(diagnostic),/PRIVATE_PROMPT|secret-key-test|is not supported with this model/);
   return true;
  });
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

test('Every reply keeps the model that wrote it, outside the logs',async()=>{
 const pg=await isolatedDatabase();const pool=database(pg.connection);const log=captured();
 try {
  await migrate(pool);await provision(pool,'global','models',configuration);
  const {conversations,conversation,input}=await conversationWith(pool,'Bonjour');
  const model={async generate(){return {text:JSON.stringify({blocks:[{type:'text',text:'Bonjour.',sources:[]}]}),calls:[]};}};
  await new Agent(pool,conversations,model,tooling).process(conversation.id);
  const sent=(await pool.query("SELECT body->'data'->'message'->>'id' AS id FROM backend_conversation_events WHERE conversation_id=$1 AND body->'data'->>'kind'='message.sent'",[conversation.id])).rows;
  assert.equal(sent.length,1);
  const row=(await pool.query('SELECT * FROM backend_reply_models WHERE conversation_id=$1',[conversation.id])).rows[0];
  assert.equal(row.reply_message_id,sent[0].id);
  assert.equal(row.input_message_id,input.id);
  assert.equal(row.origin,'model');
  assert.equal(row.config_id,'primary');
  assert.equal(row.model,'test-model');
  assert.equal(row.protocol,'responses');
  assert.equal(row.provider,'127.0.0.1:9');
  const line=log.lines.find(item=>item.event==='agent.reply_sent');
  assert.ok(line,'one line per reply');
  assert.equal(line.model,'test-model');assert.equal(line.replyMessageId,sent[0].id);assert.equal(line.origin,'model');
  assert.doesNotMatch(JSON.stringify(log.lines),/Bonjour/);
 }finally{log.restore();await pool.end();await pg.close();}
});

test('A reply written by the platform itself is recorded as such, without a model',async()=>{
 const pg=await isolatedDatabase();const pool=database(pg.connection);const log=captured();
 try {
  await migrate(pool);await provision(pool,'global','models',configuration);
  const {conversations,conversation}=await conversationWith(pool,'Bonjour');
  await pool.query("UPDATE backend_messages SET body=jsonb_set(body,'{content}','{\"type\":\"audio\",\"fileId\":\"fil_missing\"}')");
  const model={async generate(){throw new Error('The model must not run');}};
  await new Agent(pool,conversations,model,tooling).process(conversation.id).catch(()=>{});
  const rows=(await pool.query('SELECT origin,model FROM backend_reply_models WHERE conversation_id=$1',[conversation.id])).rows;
  assert.equal(rows.length,1);
  assert.ok(rows.every(row=>row.origin==='system'&&row.model===null),JSON.stringify(rows));
 }finally{log.restore();await pool.end();await pg.close();}
});

test('Abandoned processing is explained by the reply record, and a repeated refusal is logged once',async()=>{
 const pg=await isolatedDatabase();const pool=database(pg.connection);const log=captured();
 try {
  await migrate(pool);await provision(pool,'global','models',configuration);
  const {conversations,conversation,input}=await conversationWith(pool,'PRIVATE_PROMPT');
  const failure=()=>new DiagnosticProblem('Appel au fournisseur IA refusé (HTTP 400).',{stage:'model.response',provider:'synthetic',model:'test-model',upstreamStatus:400,upstreamParam:'tools',upstreamHint:'unsupported_parameter_for_model',reason:'provider_request_rejected'});
  const agent=new Agent(pool,conversations,{async generate(){throw failure();}},tooling);
  for(let attempt=0;attempt<3;attempt++)await assert.rejects(agent.process(conversation.id));
  assert.equal(log.lines.filter(item=>item.event==='agent.processing_failed').length,1,'same refusal, one line');
  assert.equal((await pool.query('SELECT attempts FROM backend_messages WHERE id=$1',[input.id])).rows[0].attempts,3,'attempts are still counted');
  await pool.query('UPDATE backend_messages SET attempts=12 WHERE id=$1',[input.id]);
  await agent.process(conversation.id);
  const exhausted=log.lines.find(item=>item.event==='agent.processing_exhausted');
  assert.equal(exhausted.attempts,12);
  assert.equal(exhausted.last_upstreamStatus,400);assert.equal(exhausted.last_upstreamParam,'tools');assert.equal(exhausted.last_reason,'provider_request_rejected');
  const row=(await pool.query('SELECT * FROM backend_reply_models WHERE conversation_id=$1',[conversation.id])).rows[0];
  assert.equal(row.origin,'error');
  assert.equal(row.detail.upstreamStatus,400);assert.equal(row.detail.upstreamParam,'tools');assert.equal(row.detail.attempts,12);
  assert.equal(exhausted.replyMessageId,row.reply_message_id);
  assert.equal(row.model,'test-model');
  assert.doesNotMatch(JSON.stringify([log.lines,row]),/PRIVATE_PROMPT/);
 }finally{log.restore();await pool.end();await pg.close();}
});
