import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateKeyPair } from 'jose';
import { isolatedDatabase } from './helpers.mjs';
import { database, migrate, provision } from '../dist/apps/backend/src/database.js';
import { Conversations } from '../dist/apps/backend/src/conversations.js';
import { Agent } from '../dist/apps/backend/src/agent.js';
import { Consent, McpProcedureCatalog } from '../dist/apps/backend/src/consent.js';
import { identifier } from '../dist/apps/backend/src/domain.js';
import { catalog } from '../dist/apps/backend/src/tooling.js';
import { DiagnosticProblem } from '../dist/apps/backend/src/diagnostics.js';

const fixtures = JSON.parse(readFileSync(new URL('../../../mocks/fixtures.json', import.meta.url)));
const procedure = { ...fixtures.schemas.Procedure, administrationId: 'alpha', validationStatus: 'validated' };
const tp = '00-' + '1'.repeat(32) + '-' + '2'.repeat(16) + '-01';
const final = (text, sources = []) => ({ text: JSON.stringify({ blocks: [{ type: 'text', text, sources }] }), calls: [] });
const toolCall = (name, args, id = 'call-1') => ({ text: '', calls: [{ id, name, arguments: JSON.stringify(args) }] });

test('pivot agent retries, provenance, consent catalogue and audio work on isolated data', async t => {
  const pg = await isolatedDatabase();
  const pool = database(pg.connection);
  t.after(async () => { await pool.end(); await pg.close(); });
  await migrate(pool);
  const conversations = new Conversations(pool);
  const user = { userRef: identifier('usr'), administrationId: 'alpha', channel: 'portal', expiresAt: Date.now() + 60000 };
  await provision(pool, 'alpha', 'models', { id: 'test', provider: 'synthetic', model: 'synthetic', promptVersion: 'agent-v1', active: true, temperature: 0 });
  for (const name of ['procedures.get', 'request.create']) await provision(pool, 'alpha', 'tools', { name, enabled: true, serverUrl: 'http://127.0.0.1:9999/mcp', secretRef: 'backend-agent' });
  let calls = [];
  let response = procedure;
  const tooling = {
    async discover() { return catalog; },
    async call(_url, _auth, name, args, context, key) {
      calls.push({ name, args, context, key });
      return { structuredContent: response, content: [{ type: 'text', text: JSON.stringify(response) }] };
    },
  };
  async function queued(content = { type: 'text', text: 'Démarche synthétique' }) {
    const c = await conversations.create(user, { channel: 'web', locale: 'fr' }, identifier('key'));
    const message = { id: identifier('msg'), content, sentAt: new Date().toISOString() };
    await conversations.accept(user, c.id, message, identifier('key'), tp);
    return { c, message };
  }
  async function lastBlocks(cid) {
    return (await pool.query("SELECT body->'data'->'message'->'blocks' AS blocks FROM backend_conversation_events WHERE conversation_id=$1 AND body->'data'->>'kind'='message.sent' ORDER BY seq DESC LIMIT 1", [cid])).rows[0].blocks;
  }
  await t.test('malformed and empty final replies recover without repeating a successful tool', async () => {
    calls = [];
    let turn = 0;
    const model = { async generate() {
      turn++;
      if (turn === 1) return toolCall('procedures.get', { procedureId: procedure.id });
      if (turn === 2) return { text: '', calls: [] };
      if (turn === 3) return { text: '{broken', calls: [] };
      return final('Données du catalogue fictif.', [procedure.source]);
    } };
    const { c } = await queued();
    await new Agent(pool, conversations, model, tooling).process(c.id);
    assert.equal(turn, 4);
    assert.equal(calls.length, 1);
    assert.deepEqual((await lastBlocks(c.id))[0].sources, [procedure.source]);
  });
  await t.test('exhausted empty replies finish clearly and are recorded without raw user text', async () => {
    let count = 0;
    const { c, message } = await queued({ type: 'text', text: 'private synthetic input' });
    await new Agent(pool, conversations, { async generate() { count++; return { text: '', calls: [] }; } }, tooling).process(c.id);
    assert.equal(count, 3);
    assert.match((await lastBlocks(c.id))[0].text, /réessayer/);
    const unanswered = (await pool.query('SELECT * FROM backend_unanswered WHERE conversation_id=$1 AND message_id=$2', [c.id, message.id])).rows;
    assert.equal(unanswered.length, 1);
    assert.equal(unanswered[0].reason, 'invalid_reply');
    assert.equal(JSON.stringify(unanswered).includes('private synthetic input'), false);
    await new Agent(pool, conversations, { async generate() { throw new Error('must not run'); } }, tooling).process(c.id);
  });
  await t.test('no source cannot authorize administrative facts', async () => {
    let count = 0;
    const { c } = await queued();
    await new Agent(pool, conversations, { async generate() { count++; return final('Le tarif est de 15000 FCFA.'); } }, tooling).process(c.id);
    assert.equal(count, 3);
    assert.match((await lastBlocks(c.id))[0].text, /source administrative validée/);
    assert.equal((await pool.query("SELECT reason FROM backend_unanswered WHERE conversation_id=$1", [c.id])).rows[0].reason, 'missing_source');
  });
  await t.test('generic MCP output cannot masquerade as a validated administrative catalogue', async () => {
    const server = { id: 'external-catalogue', name: 'External catalogue', url: 'http://127.0.0.1:9998/external', enabled: true, transport: 'streamable-http', auth: { type: 'none' }, policy: 'generic' };
    const definition = { name: 'foreign.lookup', description: 'External unvalidated data', inputSchema: { type: 'object', additionalProperties: false } };
    await pool.query('INSERT INTO backend_mcp_servers(administration_id,id,body) VALUES($1,$2,$3)', ['alpha', server.id, server]);
    await pool.query('INSERT INTO backend_mcp_tools(administration_id,server_id,name,definition,enabled,requires_mandate,available) VALUES($1,$2,$3,$4,true,false,true)', ['alpha', server.id, definition.name, definition]);
    const foreignSource = { ...procedure.source, version: 'foreign-unapproved' };
    let remoteCalls = 0;
    const externalTooling = {
      async discover(url) { return url === server.url ? [definition] : catalog; },
      async call(url) { assert.equal(url, server.url); remoteCalls++; return { structuredContent: { ...procedure, source: foreignSource }, content: [] }; },
    };
    let count = 0;
    const model = { async generate(_config, _history, tools) {
      count++;
      if (count === 1) return toolCall(tools.find(tool => tool.description === definition.description).name, {});
      return final('Le tarif est de 15000 FCFA.', [foreignSource]);
    } };
    const { c } = await queued();
    await new Agent(pool, conversations, model, externalTooling).process(c.id);
    assert.equal(remoteCalls, 1);
    assert.equal(count, 4);
    assert.deepEqual((await lastBlocks(c.id))[0].sources, []);
    assert.match((await lastBlocks(c.id))[0].text, /source administrative validée/);
    await pool.query('DELETE FROM backend_mcp_tools WHERE administration_id=$1 AND server_id=$2', ['alpha', server.id]);
    await pool.query('DELETE FROM backend_mcp_servers WHERE administration_id=$1 AND id=$2', ['alpha', server.id]);
  });
  await t.test('successful write repeated by the model returns its original evidence without another action', async () => {
    const { c } = await queued();
    const mandate = { id: identifier('mdt'), conversationId: c.id, userRef: user.userRef, procedureId: procedure.id, scopes: ['requests:write'], status: 'active', expiresAt: new Date(Date.now() + 3600000).toISOString() };
    await pool.query('INSERT INTO backend_mandates(id,conversation_id,user_ref,body) VALUES($1,$2,$3,$4)', [mandate.id, c.id, user.userRef, mandate]);
    response = { ...fixtures.schemas.Request, id: identifier('req'), conversationId: c.id, userRef: user.userRef, procedureId: procedure.id };
    calls = [];
    let count = 0;
    const model = { async generate() { count++; return count <= 2 ? toolCall('request.create', { procedureId: procedure.id }, 'write-' + count) : { text: JSON.stringify({ blocks: [{ type: 'statusCard', request: { id: response.id } }] }), calls: [] }; } };
    await new Agent(pool, conversations, model, tooling).process(c.id);
    assert.equal(calls.filter(call => call.name === 'request.create').length, 1);
    assert.deepEqual((await lastBlocks(c.id))[0].request, response);
    response = procedure;
  });
  await t.test('worker interruption after a successful write keeps the same evidence on recovery', async () => {
    const { c } = await queued();
    const mandate = { id: identifier('mdt'), conversationId: c.id, userRef: user.userRef, procedureId: procedure.id, scopes: ['requests:write'], status: 'active', expiresAt: new Date(Date.now() + 3600000).toISOString() };
    await pool.query('INSERT INTO backend_mandates(id,conversation_id,user_ref,body) VALUES($1,$2,$3,$4)', [mandate.id, c.id, user.userRef, mandate]);
    response = { ...fixtures.schemas.Request, id: identifier('req'), conversationId: c.id, userRef: user.userRef, procedureId: procedure.id };
    calls = [];
    let before = 0;
    const interrupted = { async generate() { if (!before++) return toolCall('request.create', { procedureId: procedure.id }, 'before-interruption'); throw new Error('Synthetic provider interruption'); } };
    await assert.rejects(new Agent(pool, conversations, interrupted, tooling).process(c.id));
    assert.equal(calls.length, 1);
    let after = 0;
    const resumed = { async generate() { return !after++ ? toolCall('request.create', { procedureId: procedure.id }, 'after-interruption') : { text: JSON.stringify({ blocks: [{ type: 'statusCard', request: { id: response.id } }] }), calls: [] }; } };
    await new Agent(pool, conversations, resumed, tooling).process(c.id);
    assert.equal(calls.length, 1);
    assert.deepEqual((await lastBlocks(c.id))[0].request, response);
    response = procedure;
  });
  await t.test('rejected Groq tool generation recovers without repeating an authorized write', async () => {
    const { c } = await queued();
    const mandate = { id: identifier('mdt'), conversationId: c.id, userRef: user.userRef, procedureId: procedure.id, scopes: ['requests:write'], status: 'active', expiresAt: new Date(Date.now() + 3600000).toISOString() };
    await pool.query('INSERT INTO backend_mandates(id,conversation_id,user_ref,body) VALUES($1,$2,$3,$4)', [mandate.id, c.id, user.userRef, mandate]);
    response = { ...fixtures.schemas.Request, id: identifier('req'), conversationId: c.id, userRef: user.userRef, procedureId: procedure.id };
    calls = [];
    let count = 0;
    const model = { async generate(_config, history) {
      count++;
      if (count === 1) return toolCall('request.create', { procedureId: procedure.id });
      if (count === 2) throw new DiagnosticProblem('Rejected tool generation', { reason: 'provider_tool_generation_invalid', upstreamStatus: 400, upstreamCode: 'tool_use_failed' });
      assert.ok(history.some(turn => turn.role === 'tool'));
      assert.match(history.at(-1).content, /sans appeler d’outil json/);
      return { text: JSON.stringify({ blocks: [{ type: 'statusCard', request: { id: response.id, status: 'completed' } }] }), calls: [] };
    } };
    await new Agent(pool, conversations, model, tooling).process(c.id);
    assert.equal(count, 3);
    assert.equal(calls.length, 1);
    assert.deepEqual((await lastBlocks(c.id))[0].request, response);
    assert.equal(response.status, 'draft');
    response = procedure;
  });
  await t.test('rejected Groq tool generations stop after three attempts with a clear recorded fallback', async () => {
    const { c } = await queued();
    calls = [];
    let count = 0;
    const model = { async generate() { count++; throw new DiagnosticProblem('Rejected tool generation', { reason: 'provider_tool_generation_invalid', upstreamStatus: 400, upstreamCode: 'tool_use_failed' }); } };
    await new Agent(pool, conversations, model, tooling).process(c.id);
    assert.equal(count, 3);
    assert.equal(calls.length, 0);
    assert.match((await lastBlocks(c.id))[0].text, /réessayer/);
    assert.equal((await pool.query('SELECT reason FROM backend_unanswered WHERE conversation_id=$1', [c.id])).rows[0].reason, 'invalid_reply');
  });
  await t.test('greeting and transcription use reviewed conversational text without changing original message', async () => {
    let transcriptions = 0;
    const fileId = identifier('fil');
    const file = { ...fixtures.schemas.File, id: fileId, mimeType: 'audio/ogg', expiresAt: new Date(Date.now() + 3600000).toISOString() };
    await pool.query('INSERT INTO backend_files(id,user_ref,body,object_key,expires_at) VALUES($1,$2,$3,$4,$5)', [fileId, user.userRef, file, 'synthetic-audio', file.expiresAt]);
    const { c, message } = await queued({ type: 'audio', fileId });
    const model = { async generate(_config, history) { assert.ok(history.some(turn => turn.role === 'user' && turn.content === 'Bonjour')); return final('Bonjour ! Quelle démarche souhaitez-vous effectuer ?'); } };
    const transcriber = { async transcribe(id, userRef) { transcriptions++; assert.equal(id, fileId); assert.equal(userRef, user.userRef); return 'Bonjour'; } };
    await new Agent(pool, conversations, model, tooling, undefined, transcriber).process(c.id);
    assert.equal(transcriptions, 1);
    assert.match((await lastBlocks(c.id))[0].text, /^Bonjour/);
    assert.deepEqual((await pool.query('SELECT body FROM backend_messages WHERE id=$1', [message.id])).rows[0].body.content, { type: 'audio', fileId });
    const received = (await pool.query(
      "SELECT body->'data'->'message' AS message FROM backend_conversation_events WHERE conversation_id=$1 AND body->'data'->>'kind'='message.received' ORDER BY seq",
      [c.id],
    )).rows.map((row) => row.message);
    assert.ok(received.length >= 1);
    assert.ok(received.every((item) => item.content.type === 'audio' && item.content.fileId === fileId));
    assert.ok(received.every((item) => item.transcript === 'Bonjour'));
    const unavailable = await queued({ type: 'audio', fileId });
    await new Agent(pool, conversations, { async generate() { throw new Error('no provider call'); } }, tooling).process(unavailable.c.id);
    assert.match((await lastBlocks(unavailable.c.id))[0].text, /par écrit/);
  });
  await t.test('consent reads approved MCP catalogue without requiring a local procedure', async () => {
    calls = [];
    const { privateKey } = await generateKeyPair('RS256');
    const resolver = new McpProcedureCatalog(pool, tooling);
    const consent = new Consent(pool, conversations, { async grant() { throw new Error('not used'); }, async revoke() { throw new Error('not used'); } }, { key: privateKey, kid: 'test', issuer: 'https://example.test' }, resolver);
    const { c } = await queued();
    const challenge = await consent.challenge({ ...user, administrationId: 'different-current-default' }, c.id, { procedureId: procedure.id, scopes: ['requests:write'] }, 'consent-catalogue');
    assert.ok(challenge.consentText.includes(procedure.title));
    assert.match(challenge.consentText, /préparer et modifier votre dossier/);
    assert.equal(challenge.consentText.includes('déposer votre dossier'), false);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].name, 'procedures.get');
    const replay = await consent.challenge(user, c.id, { procedureId: procedure.id, scopes: ['requests:write'] }, 'consent-catalogue');
    assert.deepEqual(replay, challenge);
    assert.equal(calls.length, 1);
    assert.equal(Number((await pool.query("SELECT count(*) FROM backend_configurations WHERE resource='procedures'")).rows[0].count), 0);
    const submission = await consent.challenge(user, c.id, { procedureId: procedure.id, scopes: ['requests:submit'] }, 'consent-submission');
    assert.match(submission.consentText, /déposer votre dossier auprès du service administratif/);
    assert.match(submission.consentText, /paiement exige une confirmation distincte/);
    response = { ...procedure, validationStatus: 'draft' };
    await assert.rejects(consent.challenge(user, c.id, { procedureId: procedure.id, scopes: ['requests:write'] }, 'consent-draft-only'), error => error.status === 404);
    response = { ...procedure, source: { ...procedure.source, procedureId: 'wrong' } };
    await assert.rejects(resolver.get(procedure.id, { administrationId: 'alpha', conversationId: c.id, userRef: user.userRef }, 'mismatch'), error => error.status === 404);
    response = procedure;
  });
});
