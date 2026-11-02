import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { HttpModels } from '../dist/apps/backend/src/model.js';
import { presentModelReply } from '../dist/apps/backend/src/model-reply.js';
import { isolatedDatabase } from './helpers.mjs';
import { database, migrate, provision } from '../dist/apps/backend/src/database.js';
import { Conversations } from '../dist/apps/backend/src/conversations.js';
import { Agent } from '../dist/apps/backend/src/agent.js';
import { identifier } from '../dist/apps/backend/src/domain.js';
import { catalog } from '../dist/apps/backend/src/tooling.js';

// Explicit opt-in; never runs against business data. The only remote calls are
// model generations containing reviewed synthetic examples. Credentials stay in
// process memory and are never included in assertions or console output.
// GROQ_LIVE_TEST=true GROQ_LIVE_MODEL=openai/gpt-oss-20b node --test apps/backend/tests/groq.live.mjs

test('live Groq: first greeting, validated synthetic catalogue, authorized synthetic action', { skip: process.env.GROQ_LIVE_TEST !== 'true', timeout: 240000 }, async t => {
  const envPath = new URL('../../../.env', import.meta.url);
  if (existsSync(envPath)) process.loadEnvFile(fileURLToPath(envPath));
  assert.ok(process.env.GROQ_API_KEY, 'GROQ_API_KEY must be set locally');
  const model = process.env.GROQ_LIVE_MODEL;
  assert.ok(model, 'GROQ_LIVE_MODEL must name the explicitly selected model');
  const providers = JSON.parse(process.env.MODEL_PROVIDERS_JSON ?? '{}');
  const provider = providers.groq ?? { baseUrl: 'https://api.groq.com/openai/v1/', protocol: 'chat-completions', apiKeyEnv: 'GROQ_API_KEY' };
  assert.equal(new URL(provider.baseUrl).hostname, 'api.groq.com');
  const httpModels = new HttpModels({ groq: provider });
  const models = { async generate(...args) {
    try { return await httpModels.generate(...args); }
    catch (error) {
      if (error?.diagnostic) t.diagnostic(JSON.stringify(error.diagnostic));
      throw error;
    }
  } };
  const config = { id: 'live-synthetic', provider: 'groq', model, promptVersion: 'agent-v1', temperature: 0, active: true };
  const greeting = await models.generate(config, [{ role: 'user', content: 'Bonjour' }], []);
  assert.equal(greeting.calls.length, 0);
  assert.match(presentModelReply(greeting.text, { sources: [], requests: [] })[0].text, /Bonjour|démarche/);
  t.diagnostic('Live provider greeting accepted with no tools; credentials and reply body omitted.');

  const pg = await isolatedDatabase();
  const pool = database(pg.connection);
  t.after(async () => { await pool.end(); await pg.close(); });
  await migrate(pool);
  const conversations = new Conversations(pool);
  const user = { userRef: identifier('usr'), administrationId: 'synthetic-live', channel: 'portal', expiresAt: Date.now() + 300000 };
  await provision(pool, user.administrationId, 'models', config);
  for (const name of ['procedures.get', 'procedures.search', 'request.create']) await provision(pool, user.administrationId, 'tools', { name, enabled: true, serverUrl: 'http://127.0.0.1:9999/synthetic-mcp', secretRef: 'synthetic-only' });
  const fixtures = JSON.parse(readFileSync(new URL('../../../mocks/fixtures.json', import.meta.url)));
  const procedure = { ...fixtures.schemas.Procedure, administrationId: user.administrationId, validationStatus: 'validated' };
  const counts = new Map();
  let createdRequest;
  const tooling = {
    async discover() { return catalog; },
    async call(_url, _auth, name, args, context) {
      counts.set(name, (counts.get(name) ?? 0) + 1);
      let value;
      if (name === 'procedures.get') { assert.equal(args.procedureId, procedure.id); value = procedure; }
      else if (name === 'procedures.search') value = { items: [procedure] };
      else if (name === 'request.create') {
        assert.ok(context.mandateId);
        assert.equal(args.procedureId, procedure.id);
        createdRequest = { ...fixtures.schemas.Request, id: identifier('req'), conversationId: context.conversationId, userRef: context.userRef, procedureId: procedure.id };
        value = createdRequest;
      } else throw new Error('Unexpected synthetic tool');
      return { structuredContent: value, content: [{ type: 'text', text: JSON.stringify(value) }] };
    },
  };
  const agent = new Agent(pool, conversations, models, tooling);
  const tp = '00-' + '1'.repeat(32) + '-' + '2'.repeat(16) + '-01';
  async function conversation(text) {
    const c = await conversations.create(user, { locale: 'fr' }, identifier('key'));
    const message = { id: identifier('msg'), content: { type: 'text', text }, sentAt: new Date().toISOString() };
    await conversations.accept(user, c.id, message, identifier('key'), tp);
    return { c, message };
  }
  async function blocks(c) {
    return (await pool.query("SELECT body->'data'->'message'->'blocks' AS blocks FROM backend_conversation_events WHERE conversation_id=$1 AND body->'data'->>'kind'='message.sent' ORDER BY seq DESC LIMIT 1", [c.id])).rows[0]?.blocks;
  }
  const lookup = await conversation('Pour cette simulation fictive sans valeur administrative : quel est le tarif et quelles pièces sont demandées pour demo-procedure ? Consulte le catalogue et cite sa source.');
  await agent.process(lookup.c.id);
  const catalogueBlocks = await blocks(lookup.c);
  assert.ok(catalogueBlocks?.some(block => block.type === 'text' && block.sources.some(source => source.procedureId === procedure.id)), 'A validated synthetic source must be returned');
  assert.ok((counts.get('procedures.get') ?? 0) + (counts.get('procedures.search') ?? 0) > 0);
  t.diagnostic('Live provider used the synthetic catalogue and returned its observed Source.');

  const action = await conversation('Simulation fictive : crée uniquement un brouillon pour demo-procedure avec request.create. Le mandat explicite a déjà été accordé par l’interface. Ne dépose et ne paie rien.');
  const mandate = { id: identifier('mdt'), conversationId: action.c.id, userRef: user.userRef, procedureId: procedure.id, scopes: ['requests:write'], status: 'active', expiresAt: new Date(Date.now() + 3600000).toISOString() };
  await pool.query('INSERT INTO backend_mandates(id,conversation_id,user_ref,body) VALUES($1,$2,$3,$4)', [mandate.id, action.c.id, user.userRef, mandate]);
  await agent.process(action.c.id);
  assert.equal(counts.get('request.create'), 1, 'The authorized synthetic action must execute once');
  assert.ok((await blocks(action.c))?.some(block => block.type === 'requestCard' && block.request.id === createdRequest.id && block.request.status === 'draft'));
  t.diagnostic('Live provider completed one authorized synthetic draft and returned its actual status. No external business action was run.');
});
