import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { HttpTranscription, transcriberFromActiveModel, transcriberFromEnvironment } from '../dist/apps/backend/src/transcription.js';
import { Files } from '../dist/apps/backend/src/files.js';
import { identifier, Problem } from '../dist/apps/backend/src/domain.js';
import { database, migrate, provision } from '../dist/apps/backend/src/database.js';
import { Conversations } from '../dist/apps/backend/src/conversations.js';
import { Agent } from '../dist/apps/backend/src/agent.js';
import { isolatedDatabase } from './helpers.mjs';
import { upsertModelSecret } from '../dist/apps/backend/src/secrets.js';

const voice = Buffer.from('OggS\0synthetic-opus-header-OpusHead-private-audio');
const secret = 'synthetic-transcription-secret';
function audioFile(bytes = voice, mimeType = 'audio/ogg') {
  return { file: { id: identifier('fil'), mimeType, sizeBytes: bytes.length, expiresAt: new Date(Date.now() + 60000).toISOString() }, bytes };
}
async function provider(t, handler) {
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const endpoint = `http://127.0.0.1:${server.address().port}/audio/transcriptions`;
  return { endpoint, options: { endpoint, allowedEndpoints: new Set([endpoint]), allowLocalhost: true } };
}
const environment = { GROQ_API_KEY: secret };

test('Audio transcription sends multipart privately and returns the actual provider text', async t => {
  const value = audioFile();
  let requests = 0;
  const mock = await provider(t, async (req, res) => {
    requests++;
    assert.equal(req.url, '/audio/transcriptions');
    assert.equal(req.headers.authorization, 'Bearer ' + secret);
    assert.match(req.headers['content-type'], /^multipart\/form-data; boundary=/);
    const parts = [];
    for await (const part of req) parts.push(part);
    const body = Buffer.concat(parts).toString();
    assert.match(body, /name="model"\r\n\r\nwhisper-large-v3-turbo/);
    assert.match(body, /filename="recording.ogg"/);
    assert.match(body, /Content-Type: audio\/ogg/i);
    assert.ok(body.includes(voice.toString()));
    assert.ok(!body.includes(value.file.id));
    assert.ok(!body.includes('private-user-reference'));
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ text: '  Je souhaite mon casier judiciaire.  ' }));
  });
  const transcription = new HttpTranscription({ async readOwned(id, owner) {
    assert.equal(id, value.file.id); assert.equal(owner, 'private-user-reference'); return value;
  } }, mock.options, environment);
  assert.equal(await transcription.transcribe(value.file.id, 'private-user-reference'), 'Je souhaite mon casier judiciaire.');
  assert.equal(requests, 1);
});

test('Files.readOwned enforces database ownership, expiry and stored size before exposing bytes', async t => {
  const pg = await isolatedDatabase();
  const pool = database(pg.connection);
  t.after(async () => { await pool.end(); await pg.close(); });
  await migrate(pool);
  const objects = new Map();
  let reads = 0;
  const files = new Files(pool, {
    async put(key, bytes) { objects.set(key, bytes); },
    async read(key) { reads++; if (!objects.has(key)) throw new Error('PRIVATE_STORAGE_ERROR'); return objects.get(key); },
    async remove(key) { objects.delete(key); },
  });
  const owner = identifier('usr');
  const file = await files.upload(owner, voice, 'audio/ogg', 'transcription-owned-001');
  await assert.rejects(files.readOwned(file.id, identifier('usr')), error => error.code === 'NOT_FOUND' && error.status === 404);
  assert.equal(reads, 0);
  assert.deepEqual((await files.readOwned(file.id, owner)).bytes, voice);
  const readBeforeExpiry = reads;
  await pool.query("UPDATE backend_files SET expires_at=now()-interval '1 second' WHERE id=$1", [file.id]);
  await assert.rejects(files.readOwned(file.id, owner), error => error.code === 'NOT_FOUND');
  assert.equal(reads, readBeforeExpiry);
  await pool.query("UPDATE backend_files SET expires_at=now()+interval '1 hour' WHERE id=$1", [file.id]);
  objects.set(file.id, Buffer.from('truncated'));
  await assert.rejects(files.readOwned(file.id, owner), error => error.code === 'UPSTREAM_UNAVAILABLE');
  objects.delete(file.id);
  await assert.rejects(files.readOwned(file.id, owner), error => error.code === 'UPSTREAM_UNAVAILABLE' && !error.message.includes('PRIVATE_STORAGE_ERROR'));
  await pool.query("UPDATE backend_files SET body=jsonb_set(body,'{expiresAt}',to_jsonb($2::text)) WHERE id=$1", [file.id, new Date(Date.now() - 1000).toISOString()]);
  const readBeforeMetadataExpiry = reads;
  await assert.rejects(files.readOwned(file.id, owner), error => error.code === 'NOT_FOUND');
  assert.equal(reads, readBeforeMetadataExpiry);
});

test('PDFs, images, oversized audio and falsely labelled audio never reach transcription provider', async t => {
  let requests = 0;
  const mock = await provider(t, (_req, res) => { requests++; res.end('{"text":"should not happen"}'); });
  const rejected = [
    [audioFile(Buffer.from('%PDF-private-document'), 'application/pdf'), 415],
    [audioFile(Buffer.from('private-image'), 'image/png'), 415],
    [audioFile(Buffer.from('%PDF-disguised-as-audio'), 'audio/ogg'), 415],
    [audioFile(Buffer.alloc(10485761), 'audio/ogg'), 413],
    [audioFile(Buffer.alloc(0), 'audio/ogg'), 400],
  ];
  for (const [value, status] of rejected) {
    const transcription = new HttpTranscription({ async readOwned() { return value; } }, mock.options, environment);
    await assert.rejects(transcription.transcribe(value.file.id, 'owner'), error => error.status === status);
  }
  assert.equal(requests, 0);
});

test('Access errors prevent any transcription call', async t => {
  let requests = 0;
  const mock = await provider(t, (_req, res) => { requests++; res.end('{}'); });
  const transcription = new HttpTranscription({ async readOwned() { throw new Problem(404, 'NOT_FOUND', 'Pièce introuvable.'); } }, mock.options, environment);
  await assert.rejects(transcription.transcribe('file', 'other-owner'), error => error.status === 404);
  assert.equal(requests, 0);
});

test('Provider refusals, invalid JSON, empty transcripts and oversized output return sanitized failures', async t => {
  for (const [status, output] of [
    [401, JSON.stringify({ error: { message: secret + ' PRIVATE_PROVIDER_ECHO' } })],
    [429, 'PRIVATE_PROVIDER_ECHO'],
    [200, 'PRIVATE_PROVIDER_ECHO'],
    [200, JSON.stringify({ text: '   ' })],
    [200, JSON.stringify({ text: 'x'.repeat(32001) })],
    [200, 'x'.repeat(262145)],
  ]) {
    const mock = await provider(t, (_req, res) => { res.writeHead(status).end(output); });
    const transcription = new HttpTranscription({ async readOwned() { return audioFile(); } }, mock.options, environment);
    await assert.rejects(transcription.transcribe('file', 'owner'), error => {
      assert.equal(error.status, 503);
      assert.equal(error.code, 'UPSTREAM_UNAVAILABLE');
      assert.doesNotMatch(error.message, /PRIVATE_PROVIDER_ECHO|synthetic-transcription-secret/);
      return true;
    });
  }
});

test('Transcription times out and refuses redirects without forwarding credentials', async t => {
  let redirectDestinationCalls = 0;
  const destination = await provider(t, (_req, res) => { redirectDestinationCalls++; res.end('{"text":"unsafe"}'); });
  const mock = await provider(t, (_req, res) => {
    res.writeHead(307, { location: destination.endpoint }).end();
  });
  const files = { async readOwned() { return audioFile(); } };
  await assert.rejects(new HttpTranscription(files, mock.options, environment).transcribe('file', 'owner'), error => error.status === 503);
  assert.equal(redirectDestinationCalls, 0);
  const stalled = await provider(t, () => {});
  await assert.rejects(new HttpTranscription(files, { ...stalled.options, timeoutMs: 20 }, environment).transcribe('file', 'owner'), error => error.status === 503);
});

test('Transcription is enabled when an API key is present; TRANSCRIPTION_ENABLED is ignored', async () => {
  const files = { async readOwned() { return audioFile(); } };
  assert.equal(transcriberFromEnvironment(files, {}), undefined);
  assert.equal(transcriberFromEnvironment(files, { TRANSCRIPTION_ENABLED: 'false' }), undefined);
  assert.ok(transcriberFromEnvironment(files, { GROQ_API_KEY: secret }));
  assert.ok(transcriberFromEnvironment(files, { MODEL_API_KEY: secret, TRANSCRIPTION_ENABLED: 'false' }));
  assert.throws(() => new HttpTranscription(files, { endpoint: 'https://unapproved.example/transcribe' }), /explicitly allowed/);
  const local = 'http://127.0.0.1:1234/transcribe';
  assert.throws(() => new HttpTranscription(files, { endpoint: local, allowedEndpoints: new Set([local]) }), /HTTPS/);
  assert.throws(() => transcriberFromEnvironment(files, { GROQ_API_KEY: secret, TRANSCRIPTION_ENDPOINT: local, TRANSCRIPTION_ALLOWED_URLS: local }), /HTTPS/);
  assert.throws(() => new HttpTranscription(files, { timeoutMs: 60001 }), /timeout/);
  assert.throws(() => new HttpTranscription(files, { apiKeyEnv: 'unsafe reference' }), /secret reference/);
  await assert.rejects(new HttpTranscription(files, {}, {}).transcribe('file', 'owner'), error => error.status === 503 && /non configurée/.test(error.message));
});

test('process() persists the transcript on message.received without changing the stored audio body', async t => {
  const pg = await isolatedDatabase();
  const pool = database(pg.connection);
  t.after(async () => { await pool.end(); await pg.close(); });
  await migrate(pool);
  await provision(pool, 'global', 'models', {
    id: 'test',
    label: 'Test',
    baseUrl: 'https://api.groq.com/openai/v1',
    protocol: 'chat-completions',
    model: 'synthetic',
    apiKeyRef: 'GROQ_API_KEY',
    temperature: 0,
    active: true,
  });
  await provision(pool, 'global', 'models', {
    id: 'voice',
    label: 'Voix',
    baseUrl: 'https://api.groq.com/openai/v1',
    protocol: 'chat-completions',
    model: 'whisper-large-v3-turbo',
    apiKeyRef: 'GROQ_API_KEY',
    temperature: 0,
    role: 'transcription',
    active: true,
  });
  const conversations = new Conversations(pool);
  const user = { userRef: identifier('usr'), channel: 'web', authenticated: true, expiresAt: Date.now() + 60000, roles: new Set() };
  const fileId = identifier('fil');
  const file = { id: fileId, mimeType: 'audio/ogg', sizeBytes: voice.length, expiresAt: new Date(Date.now() + 3600000).toISOString() };
  await pool.query('INSERT INTO backend_files(id,user_ref,body,object_key,expires_at) VALUES($1,$2,$3,$4,$5)', [fileId, user.userRef, file, 'synthetic-audio', file.expiresAt]);
  const conversation = await conversations.create(user, { locale: 'fr' }, identifier('key'));
  const message = { id: identifier('msg'), content: { type: 'audio', fileId }, sentAt: new Date().toISOString() };
  const tp = '00-' + '1'.repeat(32) + '-' + '2'.repeat(16) + '-01';
  await conversations.accept(user, conversation.id, message, identifier('key'), tp);
  const before = (await conversations.page(user.userRef, conversation.id)).items.filter(event => event.data.kind === 'message.received');
  assert.equal(before.length, 1);
  assert.equal(before[0].data.message.transcript, null);
  const model = { async generate(_config, history) {
    assert.ok(history.some(turn => turn.role === 'user' && turn.content === 'Bonjour'));
    return { text: JSON.stringify({ blocks: [{ type: 'text', text: 'Quelle démarche souhaitez-vous effectuer ?', sources: [] }] }), calls: [] };
  } };
  const tooling = { async discover() { return []; }, async call() { throw new Error('unused'); } };
  await new Agent(pool, conversations, model, tooling, undefined, { async transcribe() { return 'Bonjour'; } }).process(conversation.id);
  assert.deepEqual((await pool.query('SELECT body FROM backend_messages WHERE id=$1', [message.id])).rows[0].body.content, { type: 'audio', fileId });
  const received = (await conversations.page(user.userRef, conversation.id)).items
    .filter(event => event.data.kind === 'message.received')
    .map(event => event.data.message);
  assert.ok(received.length >= 1);
  assert.ok(received.every(item => item.content.type === 'audio' && item.content.fileId === fileId));
  assert.ok(received.every(item => item.transcript === 'Bonjour'));
});

const realFetch = globalThis.fetch;
async function viaFakeFetch(t, env, response = () => new Response(JSON.stringify({ text: 'ok' }), { status: 200 })) {
  if (globalThis.fetch === realFetch) t.after(() => { globalThis.fetch = realFetch; });
  const calls = [];
  globalThis.fetch = async (url, init) => { calls.push({ url: String(url), auth: init.headers.Authorization, model: init.body.get('model') }); return response(); };
  const transcriber = transcriberFromEnvironment({ async readOwned() { return audioFile(); } }, env);
  if (transcriber) await transcriber.transcribe('file', 'owner').catch(() => {});
  return { transcriber, calls };
}
const groqUrl = 'https://api.groq.com/openai/v1/audio/transcriptions';
const openaiUrl = 'https://api.openai.com/v1/audio/transcriptions';

test('Transcription endpoint and key follow the model provider', async t => {
  let r = await viaFakeFetch(t, { MODEL_PROVIDER: 'openai', MODEL_API_KEY: 'k-openai' });
  assert.deepEqual(r.calls, [{ url: openaiUrl, auth: 'Bearer k-openai', model: 'whisper-1' }]);
  r = await viaFakeFetch(t, { MODEL_PROVIDER: ' OpenAI ', MODEL_API_KEY: 'k-openai' });
  assert.equal(r.calls[0].url, openaiUrl);
  r = await viaFakeFetch(t, { MODEL_API_KEY: 'k-model' });
  assert.deepEqual(r.calls, [{ url: groqUrl, auth: 'Bearer k-model', model: 'whisper-large-v3-turbo' }]);
  r = await viaFakeFetch(t, { MODEL_PROVIDER: 'anthropic', MODEL_API_KEY: 'k-model' });
  assert.equal(r.transcriber, undefined);
  assert.deepEqual(r.calls, []);
  r = await viaFakeFetch(t, { MODEL_PROVIDER: 'anthropic', MODEL_API_KEY: 'k-model', GROQ_API_KEY: 'k-groq' });
  assert.deepEqual(r.calls, [{ url: groqUrl, auth: 'Bearer k-groq', model: 'whisper-large-v3-turbo' }]);
  const custom = 'https://stt.example/v1/transcriptions';
  r = await viaFakeFetch(t, { MODEL_PROVIDER: 'anthropic', MODEL_API_KEY: 'k-model', TRANSCRIPTION_ENDPOINT: custom, TRANSCRIPTION_ALLOWED_URLS: custom });
  assert.deepEqual(r.calls, [{ url: custom, auth: 'Bearer k-model', model: 'whisper-large-v3-turbo' }]);
  r = await viaFakeFetch(t, { MODEL_PROVIDER: 'openai', MODEL_API_KEY: 'k-openai', TRANSCRIPTION_MODEL: 'custom-stt' });
  assert.deepEqual(r.calls, [{ url: openaiUrl, auth: 'Bearer k-openai', model: 'custom-stt' }]);
  r = await viaFakeFetch(t, { MODEL_PROVIDER: 'anthropic', MODEL_API_KEY: 'k-model', TRANSCRIPTION_API_KEY_ENV: 'STT_KEY', STT_KEY: 'k-stt' });
  assert.deepEqual(r.calls, [{ url: groqUrl, auth: 'Bearer k-stt', model: 'whisper-large-v3-turbo' }]);
  r = await viaFakeFetch(t, { MODEL_API_KEY: 'k-model', TRANSCRIPTION_API_KEY_ENV: 'STT_KEY' });
  assert.equal(r.transcriber, undefined);
});

test('Transcription failures are logged without secrets, bodies or transcripts', async t => {
  const lines = [];
  const original = console.error;
  console.error = (...args) => { lines.push(args.join(' ')); };
  t.after(() => { console.error = original; });
  const env = { MODEL_API_KEY: secret };
  await viaFakeFetch(t, env, () => new Response('PRIVATE_PROVIDER_ECHO ' + secret, { status: 401 }));
  const log = lines.join('\n');
  assert.match(log, /transcription\.failed/);
  assert.match(log, /provider_authentication_failed/);
  assert.doesNotMatch(log, /PRIVATE_PROVIDER_ECHO|synthetic-transcription-secret/);
  lines.length = 0;
  await viaFakeFetch(t, env, () => new Response(JSON.stringify({ text: 'PRIVATE_TRANSCRIPT' }), { status: 200 }));
  assert.doesNotMatch(lines.join('\n'), /PRIVATE_TRANSCRIPT/);
  assert.equal(lines.length, 0);
});

test('the active transcription model serves voice, and the env path remains when none is active', async t => {
  const pg = await isolatedDatabase();
  const pool = database(pg.connection);
  t.after(async () => { await pool.end(); await pg.close(); });
  await migrate(pool);
  const auths = [];
  const mock = await provider(t, async (req, res) => {
    auths.push(req.headers.authorization);
    const parts = [];
    for await (const part of req) parts.push(part);
    const body = Buffer.concat(parts).toString();
    assert.match(body, /name="model"\r\n\r\nwhisper-large-v3-turbo/);
    assert.match(body, /name="language"\r\n\r\nfr/);
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ text: 'Bonjour vocal' }));
  });
  const baseUrl = mock.endpoint.replace(/\/audio\/transcriptions$/, '');
  await provision(pool, 'global', 'models', {
    id: 'chat', label: 'Chat', baseUrl: 'https://api.groq.com/openai/v1', protocol: 'chat-completions',
    model: 'synthetic', apiKeyRef: 'GROQ_API_KEY', temperature: 0, role: 'discussion', active: true,
  });
  await provision(pool, 'global', 'models', {
    id: 'voice', label: 'Voix', baseUrl, protocol: 'chat-completions',
    model: 'whisper-large-v3-turbo', apiKeyRef: 'VOICE_API_KEY', temperature: 0, role: 'transcription', active: true,
  });
  await upsertModelSecret(pool, 'global', 'voice', secret);
  const files = { async readOwned() { return audioFile(); } };
  const selected = await transcriberFromActiveModel(pool, 'global', files, { VOICE_API_KEY: 'env-must-not-win' });
  assert.equal(await selected.transcribe('file', 'owner'), 'Bonjour vocal');
  assert.deepEqual(auths, ['Bearer ' + secret]);

  const conversations = new Conversations(pool);
  const user = { userRef: identifier('usr'), channel: 'web', authenticated: true, expiresAt: Date.now() + 60000, roles: new Set() };
  const fileId = identifier('fil');
  const file = { id: fileId, mimeType: 'audio/ogg', sizeBytes: voice.length, expiresAt: new Date(Date.now() + 3600000).toISOString() };
  await pool.query('INSERT INTO backend_files(id,user_ref,body,object_key,expires_at) VALUES($1,$2,$3,$4,$5)', [fileId, user.userRef, file, 'synthetic-audio', file.expiresAt]);
  const conversation = await conversations.create(user, { locale: 'fr' }, identifier('key'));
  const message = { id: identifier('msg'), content: { type: 'audio', fileId }, sentAt: new Date().toISOString() };
  const tp = '00-' + '3'.repeat(32) + '-' + '4'.repeat(16) + '-01';
  await conversations.accept(user, conversation.id, message, identifier('key'), tp);
  const model = { async generate(_config, history) {
    assert.ok(history.some((turn) => turn.role === 'user' && turn.content === 'Bonjour vocal'));
    return { text: JSON.stringify({ blocks: [{ type: 'text', text: 'Quelle démarche souhaitez-vous effectuer ?', sources: [] }] }), calls: [] };
  } };
  const tooling = { async discover() { return []; }, async call() { throw new Error('unused'); } };
  await new Agent(pool, conversations, model, tooling, undefined, { async transcribe() { throw new Error('env transcriber must stay unused'); } }, undefined, files).process(conversation.id);
  assert.equal(auths.length, 2);
  assert.equal(auths[1], 'Bearer ' + secret);

  await pool.query("UPDATE backend_configurations SET body=jsonb_set(body,'{active}','false'::jsonb) WHERE resource_id='voice'");
  assert.equal(await transcriberFromActiveModel(pool, 'global', files, { GROQ_API_KEY: secret }), undefined);
  await pool.query("DELETE FROM backend_secrets WHERE resource_id='voice'");
  await pool.query("UPDATE backend_configurations SET body=jsonb_set(body,'{active}','true'::jsonb) WHERE resource_id='voice'");
  const fromEnv = await transcriberFromActiveModel(pool, 'global', files, { VOICE_API_KEY: 'env-key' });
  assert.equal(await fromEnv.transcribe('file', 'owner'), 'Bonjour vocal');
  assert.equal(auths.at(-1), 'Bearer env-key');
});
