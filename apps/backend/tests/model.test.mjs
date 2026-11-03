import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { HttpModels } from '../dist/apps/backend/src/model.js';
import { presentModelReply, mergeSystemBlocks, SAFE_CONVERSATIONAL_TEXT } from '../dist/apps/backend/src/model-reply.js';

const fixture = JSON.parse(readFileSync(new URL('../../../contracts/v2/examples.json', import.meta.url)));
const procedure = fixture.schemas.Procedure;
const evidence = { sources: [procedure.source], requests: [fixture.schemas.Request], procedures: [procedure] };
const text = (value, sources = []) => JSON.stringify({ blocks: [{ type: 'text', text: value, sources }] });

test('model reply keeps exact validated provenance and safe conversation copy', () => {
  assert.match(presentModelReply(text('Bonjour, comment puis-je vous aider ?'), { sources: [], requests: [] })[0].text, /Bonjour/);
  assert.equal(presentModelReply('```json\n' + text('Données fictives.', [procedure.source]) + '\n```', evidence)[0].sources[0].url, procedure.source.url);
  assert.throws(() => presentModelReply('Le tarif est de 500 FCFA.', evidence));
  assert.throws(() => presentModelReply(text('Données fictives.', [{ ...procedure.source, url: 'https://invented.example/x' }]), evidence));
  assert.throws(() => presentModelReply('{"blocks":[]}', evidence));
  assert.throws(() => presentModelReply('{"blocks":[{"type":"text","text":"","sources":[]}]}', evidence));
  const incomplete = { procedureId: procedure.source.procedureId, url: procedure.source.url };
  const bound = presentModelReply(text('Pièces indiquées sur la fiche.', [incomplete]), evidence);
  assert.deepEqual(bound[0].sources, [procedure.source]);
  assert.match(presentModelReply('Je suis l’assistant de démarches : je m’appuie sur le catalogue officiel.', { sources: [], requests: [] })[0].text, /assistant/);
});

test('model may only emit text, buttons or form; backend merges system blocks', () => {
  const request = evidence.requests[0];
  assert.throws(() => presentModelReply(JSON.stringify({ blocks: [{ type: 'statusCard', request: { id: request.id, status: 'submitted' } }] }), evidence));
  assert.throws(() => presentModelReply(JSON.stringify({ blocks: [{ type: 'fileRequest', requestId: request.id, documentType: 'extrait-acte-naissance', label: 'Document', acceptedMimeTypes: ['application/pdf'], received: false }] }), evidence));
  assert.throws(() => presentModelReply(JSON.stringify({ blocks: [{ type: 'requestCard', request }] }), evidence));
  const textBlocks = presentModelReply(JSON.stringify({ blocks: [{ type: 'text', text: 'Voici votre dossier.', sources: [procedure.source] }] }), evidence);
  const merged = mergeSystemBlocks(textBlocks, [{ type: 'requestCard', request }]);
  assert.equal(merged[0].type, 'text');
  assert.equal(merged[1].type, 'requestCard');
  assert.equal(merged[1].request.id, request.id);
});

async function provider(t, respond) {
  const bodies = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    bodies.push(JSON.parse(Buffer.concat(chunks).toString()));
    await respond(req, res, bodies.length);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
  const models = new HttpModels({ fixture: { baseUrl: baseUrl + '/', protocol: 'chat-completions', apiKeyEnv: 'TEST_PROVIDER_KEY' } }, { TEST_PROVIDER_KEY: 'synthetic-key' });
  const config = { id: 'model', label: 'Fixture', baseUrl, protocol: 'chat-completions', model: 'fixture', apiKeyRef: 'TEST_PROVIDER_KEY', temperature: 0, active: true };
  return { models, bodies, config };
}
const answer = { choices: [{ message: { content: [{ type: 'text', text: '{"blocks":' }, { type: 'text', text: '[{"type":"text","text":"Bonjour ! Quelle démarche souhaitez-vous effectuer ?","sources":[]}]}' }] } }] };

test('HTTP model omits empty tools and accepts multipart text after bounded transient retries', async t => {
  const { models, bodies, config } = await provider(t, async (req, res, attempt) => {
    assert.equal(req.headers.authorization, 'Bearer synthetic-key');
    res.setHeader('content-type', 'application/json');
    res.statusCode = attempt < 3 ? 503 : 200;
    res.end(JSON.stringify(attempt < 3 ? { error: { message: 'temporarily unavailable' } } : answer));
  });
  const result = await models.generate(config, [{ role: 'user', content: 'Bonjour' }], []);
  assert.equal(bodies.length, 3);
  assert.ok(bodies.every(body => !Object.hasOwn(body, 'tools')));
  assert.equal(JSON.parse(result.text).blocks[0].type, 'text');
});

test('HTTP authentication failures are not retried and secrets never appear in diagnostics', async t => {
  const { models, bodies, config } = await provider(t, async (_req, res) => {
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { code: 'bad_key', message: 'synthetic-key with echoed user data' } }));
  });
  await assert.rejects(models.generate(config, [{ role: 'user', content: 'Private test input' }], []), error => {
    assert.equal(error.diagnostic.reason, 'provider_authentication_failed');
    assert.equal(JSON.stringify(error).includes('synthetic-key'), false);
    assert.equal(JSON.stringify(error).includes('echoed user data'), false);
    return true;
  });
  assert.equal(bodies.length, 1);
});

test('malformed provider envelopes are retried only three times', async t => {
  const { models, bodies, config } = await provider(t, async (_req, res) => { res.end('null'); });
  await assert.rejects(models.generate(config, [{ role: 'user', content: 'Bonjour' }], []), error => error.diagnostic.reason === 'provider_response_invalid');
  assert.equal(bodies.length, 3);
});

test('only Groq tool_use_failed is classified as a rejected generation, without replaying HTTP or exposing its body', async t => {
  let requests = 0;
  let status = 400;
  let code = 'tool_use_failed';
  t.mock.method(globalThis, 'fetch', async () => {
    requests++;
    return new Response(JSON.stringify({ error: { code, message: 'private synthetic text', failed_generation: '{"name":"json","arguments":{"private":"synthetic-secret"}}' } }), { status });
  });
  const models = new HttpModels({
    groq: { baseUrl: 'https://api.groq.com/openai/v1/', protocol: 'chat-completions' },
    independent: { baseUrl: 'https://provider.example.test/v1/', protocol: 'chat-completions' },
  }, { TEST_KEY: 'k' });
  const asConfig = (baseUrl) => ({ id: 'model', label: 'Fixture', baseUrl, protocol: 'chat-completions', model: 'fixture', apiKeyRef: 'TEST_KEY', temperature: 0, active: true });
  for (const scenario of [
    { baseUrl: 'https://api.groq.com/openai/v1', status: 400, code: 'tool_use_failed', reason: 'provider_tool_generation_invalid' },
    { baseUrl: 'https://provider.example.test/v1', status: 400, code: 'tool_use_failed', reason: 'provider_request_rejected' },
    { baseUrl: 'https://api.groq.com/openai/v1', status: 400, code: 'invalid_request', reason: 'provider_request_rejected' },
    { baseUrl: 'https://api.groq.com/openai/v1', status: 401, code: 'tool_use_failed', reason: 'provider_authentication_failed' },
    { baseUrl: 'https://api.groq.com/openai/v1', status: 403, code: 'tool_use_failed', reason: 'provider_access_forbidden' },
  ]) {
    status = scenario.status;
    code = scenario.code;
    const before = requests;
    await assert.rejects(models.generate(asConfig(scenario.baseUrl), [{ role: 'user', content: 'Synthetic test' }], []), error => {
      assert.equal(error.diagnostic.reason, scenario.reason);
      assert.equal(JSON.stringify(error).includes('synthetic-secret'), false);
      assert.equal(JSON.stringify(error).includes('private synthetic text'), false);
      return true;
    });
    assert.equal(requests, before + 1);
  }
});

test('Groq GPT-OSS sends sequential tool use while other provider capabilities remain explicit', async t => {
  const bodies = [];
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    bodies.push(JSON.parse(init.body));
    return new Response(JSON.stringify(answer), { headers: { 'content-type': 'application/json' } });
  });
  const models = new HttpModels({
    groq: { baseUrl: 'https://api.groq.com/openai/v1/', protocol: 'chat-completions' },
    independent: { baseUrl: 'https://provider.example.test/v1/', protocol: 'chat-completions' },
    sequential: { baseUrl: 'https://provider.example.test/v1/', protocol: 'chat-completions', parallelToolCalls: false },
  }, { TEST_KEY: 'k' });
  const asConfig = (baseUrl, model = 'fixture') => ({ id: 'model', label: 'Fixture', baseUrl, protocol: 'chat-completions', model, apiKeyRef: 'TEST_KEY', temperature: 0, active: true });
  const tools = [{ name: 'fixture.read', inputSchema: { type: 'object' } }];
  for (const model of ['openai/gpt-oss-20b', 'openai/gpt-oss-120b', 'openai/gpt-oss-safeguard-20b']) {
    await models.generate(asConfig('https://api.groq.com/openai/v1', model), [{ role: 'user', content: 'Synthetic test' }], tools);
    assert.equal(bodies.at(-1).parallel_tool_calls, false);
  }
  await models.generate(asConfig('https://api.groq.com/openai/v1', 'openai/gpt-oss-20b'), [{ role: 'user', content: 'Bonjour' }], []);
  assert.equal(Object.hasOwn(bodies.at(-1), 'parallel_tool_calls'), false);
  await models.generate(asConfig('https://api.groq.com/openai/v1', 'llama-3.3-70b-versatile'), [{ role: 'user', content: 'Synthetic test' }], tools);
  assert.equal(Object.hasOwn(bodies.at(-1), 'parallel_tool_calls'), false);
  await models.generate(asConfig('https://provider.example.test/v1', 'openai/gpt-oss-20b'), [{ role: 'user', content: 'Synthetic test' }], tools);
  assert.equal(Object.hasOwn(bodies.at(-1), 'parallel_tool_calls'), false);
});

test('Groq streamed tool_use_failed is classified without treating the SSE as an invalid envelope', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response(
    'data: {"choices":[{"delta":{"role":"assistant","content":""}}]}\n\ndata: {"error":{"code":"tool_use_failed","type":"invalid_request_error","message":"private","failed_generation":"secret"}}\n\n',
    { headers: { 'content-type': 'text/event-stream' } },
  ));
  const models = new HttpModels({ groq: { baseUrl: 'https://api.groq.com/openai/v1/', protocol: 'chat-completions' } }, { TEST_KEY: 'k' });
  const config = { id: 'model', label: 'Fixture', baseUrl: 'https://api.groq.com/openai/v1', protocol: 'chat-completions', model: 'openai/gpt-oss-20b', apiKeyRef: 'TEST_KEY', temperature: 0, active: true };
  await assert.rejects(models.generate(config, [{ role: 'user', content: 'Synthetic test' }], [{ name: 'fixture.read', inputSchema: { type: 'object' } }], { onTextDelta() {} }), error => {
    assert.equal(error.diagnostic.reason, 'provider_tool_generation_invalid');
    assert.equal(JSON.stringify(error).includes('secret'), false);
    return true;
  });
});

test('structured output is requested on Groq then dropped after a 400', async t => {
  const bodies = [];
  const statuses = [400, 200];
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    bodies.push(JSON.parse(init.body));
    const status = statuses.shift() ?? 200;
    if (status !== 200) return new Response(JSON.stringify({ error: { code: 'invalid_request', message: 'schema' } }), { status });
    return new Response(JSON.stringify(answer), { headers: { 'content-type': 'application/json' } });
  });
  const models = new HttpModels({ groq: { baseUrl: 'https://api.groq.com/openai/v1/', protocol: 'chat-completions' } }, { TEST_KEY: 'k' });
  const config = { id: 'model', label: 'Fixture', baseUrl: 'https://api.groq.com/openai/v1', protocol: 'chat-completions', model: 'llama-3.3-70b-versatile', apiKeyRef: 'TEST_KEY', temperature: 0, active: true };
  await models.generate(config, [{ role: 'user', content: 'Bonjour' }], [], { structuredOutput: true });
  assert.equal(bodies[0].response_format?.type, 'json_schema');
  assert.equal(bodies[1].response_format?.type, 'json_object');
});
