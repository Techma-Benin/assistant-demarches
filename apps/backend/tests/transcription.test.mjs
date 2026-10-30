import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { HttpTranscription, transcriberFromEnvironment } from '../dist/apps/backend/src/transcription.js';
import { Files } from '../dist/apps/backend/src/files.js';
import { identifier, Problem } from '../dist/apps/backend/src/domain.js';
import { database, migrate } from '../dist/apps/backend/src/database.js';
import { isolatedDatabase } from './helpers.mjs';

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

test('Transcription is explicitly enabled and endpoints, references and timeouts are validated', async () => {
  const files = { async readOwned() { return audioFile(); } };
  assert.equal(transcriberFromEnvironment(files, {}), undefined);
  assert.equal(transcriberFromEnvironment(files, { TRANSCRIPTION_ENABLED: 'false' }), undefined);
  assert.ok(transcriberFromEnvironment(files, { TRANSCRIPTION_ENABLED: 'true' }));
  assert.throws(() => new HttpTranscription(files, { endpoint: 'https://unapproved.example/transcribe' }), /explicitly allowed/);
  const local = 'http://127.0.0.1:1234/transcribe';
  assert.throws(() => new HttpTranscription(files, { endpoint: local, allowedEndpoints: new Set([local]) }), /HTTPS/);
  assert.throws(() => transcriberFromEnvironment(files, { TRANSCRIPTION_ENABLED: 'true', TRANSCRIPTION_ENDPOINT: local, TRANSCRIPTION_ALLOWED_URLS: local }), /HTTPS/);
  assert.throws(() => new HttpTranscription(files, { timeoutMs: 60001 }), /timeout/);
  assert.throws(() => new HttpTranscription(files, { apiKeyEnv: 'unsafe reference' }), /secret reference/);
  await assert.rejects(new HttpTranscription(files, {}, {}).transcribe('file', 'owner'), error => error.status === 503 && /non configurée/.test(error.message));
});
