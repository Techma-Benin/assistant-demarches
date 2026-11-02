import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { HttpModels } from '../dist/apps/backend/src/model.js';

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString());
}

async function listen(t, handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  return `http://127.0.0.1:${server.address().port}/v1/`;
}

function modelsFor(baseUrl, protocol) {
  return new HttpModels(
    { fixture: { baseUrl, protocol, apiKeyEnv: 'TEST_PROVIDER_KEY' } },
    { TEST_PROVIDER_KEY: 'synthetic-key' },
  );
}

function config(baseUrl, protocol) {
  return {
    id: 'model',
    label: 'Fixture',
    baseUrl,
    protocol,
    model: 'fixture',
    apiKeyRef: 'TEST_PROVIDER_KEY',
    temperature: 0,
    active: true,
  };
}

const history = [{ role: 'user', content: 'Salut' }];

test('chat completion stream emits text deltas and returns the joined reply', async (t) => {
  let body;
  const sse = 'data: {"choices":[{"delta":{"content":"Bon"}}]}\n\ndata: {"choices":[{"delta":{"content":"jour"}}]}\n\ndata: [DONE]\n';
  const baseUrl = await listen(t, async (req, res) => {
    body = await readJson(req);
    assert.equal(req.url, '/v1/chat/completions');
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write(sse.slice(0, 20));
    res.end(sse.slice(20));
  });
  const deltas = [];
  let active = 0;
  let overlapped = false;
  const reply = await modelsFor(baseUrl, 'chat-completions').generate(config(baseUrl, 'chat-completions'), history, [], {
    async onTextDelta(delta) {
      active += 1;
      if (active > 1) overlapped = true;
      await new Promise((resolve) => setTimeout(resolve, 10));
      deltas.push(delta);
      active -= 1;
    },
  });
  assert.deepEqual(deltas, ['Bon', 'jour']);
  assert.equal(overlapped, false);
  assert.equal(reply.text, 'Bonjour');
  assert.deepEqual(reply.calls, []);
  assert.equal(body.stream, true);
});

test('without onTextDelta a JSON completion is requested without stream', async (t) => {
  let body;
  const baseUrl = await listen(t, async (req, res) => {
    body = await readJson(req);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: 'Bonjour', tool_calls: [{ id: 'call_1', function: { name: 'lookup_thing', arguments: '{}' } }] } }] }));
  });
  const tools = [{ name: 'lookup.thing', description: 'Lookup', inputSchema: { type: 'object' } }];
  const reply = await modelsFor(baseUrl, 'chat-completions').generate(config(baseUrl, 'chat-completions'), history, tools);
  assert.equal(reply.text, 'Bonjour');
  assert.deepEqual(reply.calls, [{ id: 'call_1', name: 'lookup.thing', arguments: '{}' }]);
  assert.equal(Object.hasOwn(body, 'stream'), false);
});

test('chat stream assembles tool calls without emitting argument fragments', async (t) => {
  const sse = [
    'data: {"choices":[{"delta":{"content":"Bon","tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"lookup_thing","arguments":""}}]}}]}',
    '',
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{}"}}]}}]}',
    '',
    'data: {"choices":[{"delta":{"content":[{"type":"text","text":"jour"}]}}]}',
    '',
    ': comment',
    '',
    'data: [DONE]',
    '',
  ].join('\n');
  const baseUrl = await listen(t, async (req, res) => {
    await readJson(req);
    res.writeHead(200, { 'Content-Type': 'text/event-stream' }).end(sse);
  });
  const deltas = [];
  const tools = [{ name: 'lookup.thing', description: 'Lookup', inputSchema: { type: 'object' } }];
  const reply = await modelsFor(baseUrl, 'chat-completions').generate(config(baseUrl, 'chat-completions'), history, tools, {
    onTextDelta(delta) { deltas.push(delta); },
  });
  assert.deepEqual(deltas, ['Bon', 'jour']);
  assert.equal(reply.text, 'Bonjour');
  assert.deepEqual(reply.calls, [{ id: 'call_1', name: 'lookup.thing', arguments: '{}' }]);
});

test('responses stream emits output text and keeps the completed response shape', async (t) => {
  const output = [
    { type: 'message', content: [{ type: 'output_text', text: 'Bonjour' }] },
    { type: 'function_call', call_id: 'call_1', name: 'lookup_thing', arguments: '{}' },
  ];
  const sse = [
    'event: response.output_text.delta',
    'data: {"type":"response.output_text.delta","delta":"Bon"}',
    '',
    'data: {"type":"response.function_call_arguments.delta","output_index":1,"delta":"{}"}',
    '',
    'event: response.output_text.delta',
    'data: {"delta":"jour"}',
    '',
    'data: ' + JSON.stringify({ type: 'response.completed', response: { output } }),
    '',
  ].join('\n');
  let body;
  const baseUrl = await listen(t, async (req, res) => {
    body = await readJson(req);
    assert.equal(req.url, '/v1/responses');
    res.writeHead(200, { 'Content-Type': 'text/event-stream' }).end(sse);
  });
  const deltas = [];
  const tools = [{ name: 'lookup.thing', description: 'Lookup', inputSchema: { type: 'object' } }];
  const reply = await modelsFor(baseUrl, 'responses').generate(config(baseUrl, 'responses'), history, tools, {
    onTextDelta(delta) { deltas.push(delta); },
  });
  assert.deepEqual(deltas, ['Bon', 'jour']);
  assert.equal(reply.text, 'Bonjour');
  assert.deepEqual(reply.calls, [{ id: 'call_1', name: 'lookup.thing', arguments: '{}' }]);
  assert.deepEqual(reply.rawOutput, output);
  assert.equal(body.stream, true);
});

test('responses stream without a completed event still assembles text', async (t) => {
  const sse = 'data: {"type":"response.output_text.delta","delta":"Bon"}\n\ndata: {"type":"response.output_text.delta","delta":"jour"}\n\n';
  const baseUrl = await listen(t, async (req, res) => {
    await readJson(req);
    res.writeHead(200, { 'Content-Type': 'text/event-stream' }).end(sse);
  });
  const deltas = [];
  const reply = await modelsFor(baseUrl, 'responses').generate(config(baseUrl, 'responses'), history, [], {
    onTextDelta(delta) { deltas.push(delta); },
  });
  assert.deepEqual(deltas, ['Bon', 'jour']);
  assert.equal(reply.text, 'Bonjour');
  assert.deepEqual(reply.calls, []);
});

test('provider HTTP errors do not call onTextDelta', async (t) => {
  let calls = 0;
  const baseUrl = await listen(t, async (req, res) => {
    await readJson(req);
    res.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: { message: 'refused' } }));
  });
  await assert.rejects(
    modelsFor(baseUrl, 'chat-completions').generate(config(baseUrl, 'chat-completions'), history, [], {
      onTextDelta() { calls += 1; },
    }),
    (error) => error.diagnostic?.reason === 'provider_request_rejected',
  );
  assert.equal(calls, 0);
});

test('a stream that breaks mid-event rejects', async (t) => {
  const baseUrl = await listen(t, async (req, res) => {
    await readJson(req);
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.end('data: {"choices":[{"delta":{"content":"Bon"}}]}\n\ndata: {"choices":[{"delta":{"content":');
  });
  const deltas = [];
  await assert.rejects(
    modelsFor(baseUrl, 'chat-completions').generate(config(baseUrl, 'chat-completions'), history, [], {
      onTextDelta(delta) { deltas.push(delta); },
    }),
    (error) => error.diagnostic?.reason === 'provider_response_invalid',
  );
  // Invalid streams are retried, but a retry never replays text the listener already received.
  assert.deepEqual(deltas, ['Bon']);
});

test('onToolCall fires before the text of the same chunk (chat) and on a function_call item (responses)', async (t) => {
  const chat = [
    'data: {"choices":[{"delta":{"content":"Texte ","tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"lookup_thing","arguments":"{}"}}]}}]}',
    '',
    'data: [DONE]',
    '',
  ].join('\n');
  const chatUrl = await listen(t, async (req, res) => { await readJson(req); res.writeHead(200, { 'Content-Type': 'text/event-stream' }).end(chat); });
  const order = [];
  const tools = [{ name: 'lookup.thing', description: 'Lookup', inputSchema: { type: 'object' } }];
  await modelsFor(chatUrl, 'chat-completions').generate(config(chatUrl, 'chat-completions'), history, tools, {
    onTextDelta(delta) { order.push('text:' + delta); },
    onToolCall() { order.push('tool'); },
  });
  assert.equal(order[0], 'tool');

  const responses = [
    'data: {"type":"response.output_text.delta","delta":"Avant"}',
    '',
    'data: {"type":"response.output_item.added","output_index":1,"item":{"type":"function_call","call_id":"call_1","name":"lookup_thing","arguments":""}}',
    '',
    'data: ' + JSON.stringify({ type: 'response.completed', response: { output: [{ type: 'function_call', call_id: 'call_1', name: 'lookup_thing', arguments: '{}' }] } }),
    '',
  ].join('\n');
  const responsesUrl = await listen(t, async (req, res) => { await readJson(req); res.writeHead(200, { 'Content-Type': 'text/event-stream' }).end(responses); });
  const seen = [];
  await modelsFor(responsesUrl, 'responses').generate(config(responsesUrl, 'responses'), history, tools, {
    onTextDelta(delta) { seen.push('text:' + delta); },
    onToolCall() { seen.push('tool'); },
  });
  assert.deepEqual(seen, ['text:Avant', 'tool']);
});
