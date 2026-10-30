import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { HttpModels } from '../dist/apps/backend/src/model.js';
import { presentModelReply, SAFE_CONVERSATIONAL_TEXT } from '../dist/apps/backend/src/model-reply.js';

const fixture = JSON.parse(readFileSync(new URL('../../../mocks/fixtures.json', import.meta.url)));
const procedure = { ...fixture.schemas.Procedure, validationStatus: 'validated' };
const evidence = { sources: [procedure.source], requests: [fixture.schemas.Request], procedures: [procedure] };
const text = (value, sources = []) => JSON.stringify({ blocks: [{ type: 'text', text: value, sources }] });

test('model reply keeps exact validated provenance and safe conversation copy', () => {
  for (const value of SAFE_CONVERSATIONAL_TEXT) assert.equal(presentModelReply(text(value), { sources: [], requests: [] })[0].text, value);
  assert.equal(presentModelReply('```json\n' + text('Données fictives.', [procedure.source]) + '\n```', evidence)[0].sources[0].url, procedure.source.url);
  assert.throws(() => presentModelReply(text('Le tarif est de 500 FCFA.'), evidence));
  assert.throws(() => presentModelReply('Le tarif est de 500 FCFA.', evidence));
  assert.throws(() => presentModelReply(text('Données fictives.', [{ ...procedure.source, version: 'invented' }]), evidence));
  assert.throws(() => presentModelReply('{"blocks":[]}', evidence));
  assert.throws(() => presentModelReply('{"blocks":[{"type":"text","text":"","sources":[]}]}', evidence));
});

test('status and document blocks derive from observed tool data', () => {
  const request = evidence.requests[0];
  assert.deepEqual(presentModelReply(JSON.stringify({ blocks: [{ type: 'statusCard', request: { id: request.id, status: 'completed' } }] }), evidence), [{ type: 'statusCard', request }]);
  assert.throws(() => presentModelReply(JSON.stringify({ blocks: [{ type: 'statusCard', request: { id: 'req_fabricated' } }] }), evidence));
  const file = { type: 'fileRequest', documentType: procedure.requiredDocuments[0], label: 'Document', acceptedMimeTypes: ['application/pdf'] };
  assert.deepEqual(presentModelReply(JSON.stringify({ blocks: [file] }), evidence), [file]);
  assert.throws(() => presentModelReply(JSON.stringify({ blocks: [{ ...file, documentType: 'invented-document' }] }), evidence));
  assert.throws(() => presentModelReply(JSON.stringify({ blocks: [file] }), { sources: [], requests: [] }));
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
  const models = new HttpModels({ fixture: { baseUrl: `http://127.0.0.1:${server.address().port}/v1/`, protocol: 'chat-completions', apiKeyEnv: 'TEST_PROVIDER_KEY' } }, { TEST_PROVIDER_KEY: 'synthetic-key' });
  return { models, bodies };
}
const config = { id: 'model', provider: 'fixture', model: 'fixture', promptVersion: 'agent-v1', temperature: 0, active: true };
const answer = { choices: [{ message: { content: [{ type: 'text', text: '{"blocks":' }, { type: 'text', text: '[{"type":"text","text":"Bonjour ! Quelle démarche souhaitez-vous effectuer ?","sources":[]}]}' }] } }] };

test('HTTP model omits empty tools and accepts multipart text after bounded transient retries', async t => {
  const { models, bodies } = await provider(t, async (req, res, attempt) => {
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
  const { models, bodies } = await provider(t, async (_req, res) => {
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
  const { models, bodies } = await provider(t, async (_req, res) => { res.end('null'); });
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
  });
  for (const scenario of [
    { provider: 'groq', status: 400, code: 'tool_use_failed', reason: 'provider_tool_generation_invalid' },
    { provider: 'independent', status: 400, code: 'tool_use_failed', reason: 'provider_request_rejected' },
    { provider: 'groq', status: 400, code: 'invalid_request', reason: 'provider_request_rejected' },
    { provider: 'groq', status: 401, code: 'tool_use_failed', reason: 'provider_authentication_failed' },
    { provider: 'groq', status: 403, code: 'tool_use_failed', reason: 'provider_access_forbidden' },
  ]) {
    status = scenario.status;
    code = scenario.code;
    const before = requests;
    await assert.rejects(models.generate({ ...config, provider: scenario.provider }, [{ role: 'user', content: 'Synthetic test' }], []), error => {
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
  });
  const tools = [{ name: 'fixture.read', inputSchema: { type: 'object' } }];
  for (const model of ['openai/gpt-oss-20b', 'openai/gpt-oss-120b', 'openai/gpt-oss-safeguard-20b']) {
    await models.generate({ ...config, provider: 'groq', model }, [{ role: 'user', content: 'Synthetic test' }], tools);
    assert.equal(bodies.at(-1).parallel_tool_calls, false);
  }
  await models.generate({ ...config, provider: 'groq', model: 'openai/gpt-oss-20b' }, [{ role: 'user', content: 'Bonjour' }], []);
  assert.equal(Object.hasOwn(bodies.at(-1), 'parallel_tool_calls'), false);
  await models.generate({ ...config, provider: 'groq', model: 'llama-3.3-70b-versatile' }, [{ role: 'user', content: 'Synthetic test' }], tools);
  assert.equal(Object.hasOwn(bodies.at(-1), 'parallel_tool_calls'), false);
  await models.generate({ ...config, provider: 'independent', model: 'openai/gpt-oss-20b' }, [{ role: 'user', content: 'Synthetic test' }], tools);
  assert.equal(Object.hasOwn(bodies.at(-1), 'parallel_tool_calls'), false);
  await models.generate({ ...config, provider: 'sequential' }, [{ role: 'user', content: 'Synthetic test' }], tools);
  assert.equal(bodies.at(-1).parallel_tool_calls, false);
});
