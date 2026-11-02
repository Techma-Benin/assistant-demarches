// Replays, request by request, what apps/interface/web sends to the Backend (src/lib/c1-client.ts,
// conversation-stream.ts, voice.ts, server/auth/callback): same methods, headers and bodies.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID, randomBytes } from "node:crypto";
import { once } from "node:events";
import { WebSocket } from "ws";
import { generateKeyPair, exportJWK, createLocalJWKSet, SignJWT } from "jose";
import { isolatedDatabase } from "./helpers.mjs";
import { database, migrate, provision } from "../dist/apps/backend/src/database.js";
import { createBackend } from "../dist/apps/backend/src/app.js";
import { Conversations, RESUME_AFTER_LOGIN } from "../dist/apps/backend/src/conversations.js";
import { Identities } from "../dist/apps/backend/src/identity.js";
import { Files } from "../dist/apps/backend/src/files.js";
import { LocalStorage } from "../dist/apps/backend/src/storage.js";
import { HttpTranscription } from "../dist/apps/backend/src/transcription.js";
import { Agent } from "../dist/apps/backend/src/agent.js";
import { HttpModels } from "../dist/apps/backend/src/model.js";
import { transaction } from "../dist/apps/backend/src/transactions.js";
import { identifier, validate } from "../dist/apps/backend/src/domain.js";
import { socketOriginAllowed } from "../dist/apps/backend/src/sockets.js";
import { documentDisposition } from "../dist/apps/backend/src/download.js";

const FRONT_ORIGIN = "http://127.0.0.1:3000";
const MODEL_KEY = "synthetic-model-key";
const REPLY = "Bonjour, je peux vous aider pour votre démarche de casier judiciaire dès maintenant.";
const TRANSCRIPT = "Je voudrais savoir comment faire ma demande.";
// First bytes of a MediaRecorder `audio/webm;codecs=opus` recording: the EBML header.
const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), randomBytes(2048)]);

// Same shape as apps/interface/web/src/lib/trace.ts.
const traceparent = () => `00-${randomBytes(16).toString("hex")}-${randomBytes(8).toString("hex")}-01`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const isContractEvent = (value) => // conversation-stream.ts
  typeof value?.id === "string" && value.id.startsWith("evt_") && typeof value.data?.kind === "string";

function listen(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}
const close = (server) => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); });

async function harness(t) {
  const pg = await isolatedDatabase();
  const pool = database(pg.connection);
  const dir = mkdtempSync(join(tmpdir(), "interface-wiring-"));
  const stop = new AbortController();
  const modelCalls = [];
  const transcriptionCalls = [];
  const behaviour = { model: (_body) => REPLY };
  const model = await listen(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    assert.equal(req.headers.authorization, "Bearer " + MODEL_KEY);
    modelCalls.push(body);
    const text = behaviour.model(body);
    const json = JSON.stringify({ blocks: [{ type: "text", text, sources: [] }] });
    // Provider-sized pieces: several words per chunk, split inside the text value like a real SSE stream.
    const start = json.indexOf(text);
    const words = text.split(/(?<= )/);
    const pieces = [json.slice(0, start)];
    for (let index = 0; index < words.length; index += 3) pieces.push(words.slice(index, index + 3).join(""));
    pieces.push(json.slice(start + text.length));
    res.writeHead(200, { "content-type": "text/event-stream" });
    for (const piece of pieces) {
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`);
      await sleep(10);
    }
    res.end("data: [DONE]\n\n");
  });
  const transcriber = await listen(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks);
    transcriptionCalls.push({ authorization: req.headers.authorization, contentType: req.headers["content-type"], raw });
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ text: ` ${TRANSCRIPT} ` }));
  });
  t.after(async () => {
    stop.abort();
    await close(model);
    await close(transcriber);
    await pool.end();
    await pg.close();
    rmSync(dir, { recursive: true, force: true });
  });
  await migrate(pool);
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "wiring", alg: "RS256" };
  const issuer = "https://identity.example.test/wiring";
  const guestIssuer = "http://127.0.0.1:4010";
  const auth = {
    issuer,
    audience: "techma-backend",
    key: createLocalJWKSet({ keys: [jwk] }),
    guestIssuer,
    guestKey: createLocalJWKSet({ keys: [jwk] }),
  };
  const citizen = (sub = "aminata") =>
    new SignJWT({ scope: "citizen", realm_access: { roles: ["citizen"] } })
      .setProtectedHeader({ alg: "RS256", kid: "wiring" })
      .setSubject(sub)
      .setIssuer(issuer)
      .setAudience("techma-backend")
      .setIssuedAt()
      .setExpirationTime("10m")
      .sign(privateKey);
  const conversations = new Conversations(pool);
  const files = new Files(pool, new LocalStorage(dir));
  const runtime = {
    pool,
    auth,
    identities: new Identities(pool),
    conversations,
    files,
    signing: { key: privateKey, kid: "wiring", issuer: guestIssuer },
  };
  await provision(pool, "global", "models", {
    id: "main",
    label: "Factice",
    baseUrl: `http://127.0.0.1:${model.address().port}/v1`,
    protocol: "chat-completions",
    model: "synthetic",
    apiKeyRef: "WIRING_MODEL_KEY",
    temperature: 0,
    active: true,
  });
  process.env.WIRING_MODEL_KEY = MODEL_KEY;
  t.after(() => { delete process.env.WIRING_MODEL_KEY; });
  const endpoint = `http://127.0.0.1:${transcriber.address().port}/audio/transcriptions`;
  const makeAgent = (withTranscription) => new Agent(
    pool,
    conversations,
    new HttpModels({}),
    { async discover() { return []; }, async call() { throw new Error("unused"); } },
    undefined,
    // The provider key comes from the environment object, like TRANSCRIPTION_API_KEY_ENV in production.
    withTranscription
      ? new HttpTranscription(files, { endpoint, allowedEndpoints: new Set([endpoint]), allowLocalhost: true, apiKeyEnv: "TRANSCRIPTION_KEY" }, { TRANSCRIPTION_KEY: "synthetic-transcription-key" })
      : undefined,
  );
  const agent = makeAgent(false);
  const app = await createBackend({ pool, auth, allowedMcpUrls: new Set(), corsOrigins: [FRONT_ORIGIN], runtime });
  t.after(() => app.close());
  await app.listen(0, "127.0.0.1");
  const base = (await app.getUrl()).replace("[::1]", "127.0.0.1");
  runtime.publicUrl = base;
  return { pool, conversations, files, agent, makeAgent, runtime, base, stop, modelCalls, transcriptionCalls, behaviour, citizen };
}

/** `fetch` the way c1-client.ts builds its requests (after the Interface proxy: Bearer added, headers forwarded). */
function client(base, token) {
  const call = async (method, path, { body, rawBody, headers = {}, idempotencyKey } = {}) => {
    const response = await fetch(base + path, {
      method,
      headers: {
        traceparent: traceparent(),
        ...headers,
        ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: rawBody ?? (body !== undefined ? JSON.stringify(body) : undefined),
    });
    const text = await response.text();
    return { status: response.status, headers: response.headers, json: text && response.headers.get("content-type")?.includes("json") ? JSON.parse(text) : undefined, text };
  };
  return {
    call,
    createConversation: () => call("POST", "/v1/conversations", { body: { locale: "fr" }, idempotencyKey: randomUUID() }),
    sendMessage: (conversationId, input) => call("POST", `/v1/conversations/${conversationId}/messages`, { body: input, idempotencyKey: input.id }),
    listEvents: (conversationId, cursor) => call("GET", `/v1/conversations/${conversationId}/events${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`),
    socketTicket: (conversationId) => call("POST", `/v1/conversations/${conversationId}/socket-ticket`, { idempotencyKey: randomUUID() }),
    uploadFile: (bytes, mimeType) => call("POST", "/v1/files", {
      rawBody: bytes,
      headers: { "content-type": "application/octet-stream", "x-file-mime-type": mimeType },
      idempotencyKey: randomUUID(),
    }),
  };
}

/** conversation-stream.ts: ticket, then `new WebSocket(ticket.url + &cursor)`; frames are JSON events. */
async function openStream(api, conversationId, { cursor, origin = FRONT_ORIGIN } = {}) { // origin: null sends no Origin header
  const ticket = await api.socketTicket(conversationId);
  assert.equal(ticket.status, 201, ticket.text);
  const url = new URL(ticket.json.url);
  assert.ok(["ws:", "wss:"].includes(url.protocol));
  if (cursor) url.searchParams.set("cursor", cursor);
  const frames = [];
  const socket = new WebSocket(url.toString(), origin === null ? {} : { origin });
  socket.on("message", (data) => {
    const parsed = JSON.parse(data.toString());
    assert.ok(isContractEvent(parsed), "frame is not an Event");
    frames.push(parsed);
  });
  const closed = new Promise((resolve) => socket.on("close", (code, reason) => resolve({ code, reason: reason.toString() })));
  await new Promise((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); socket.once("unexpected-response", (_req, res) => reject(Object.assign(new Error("refused"), { status: res.statusCode }))); });
  return { frames, socket, closed, ticket: ticket.json };
}
async function until(predicate, timeout = 8000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeout) throw new Error("timed out");
    await sleep(10);
  }
}
// conversation-state.ts applyDelta: ordered by index when present.
function assemble(frames, messageId) {
  const indexed = new Map();
  for (const frame of frames) {
    if (frame.data.kind !== "message.delta" || frame.data.messageId !== messageId) continue;
    if (!indexed.has(frame.data.index)) indexed.set(frame.data.index, frame.data.delta);
  }
  return [...indexed.keys()].sort((a, b) => a - b).map((index) => indexed.get(index)).join("");
}

test("voice message from the Interface: webm upload, transcript on message.received, multi-word deltas, message.sent", async (t) => {
  const h = await harness(t);
  const agent = h.makeAgent(true);
  const worker = agent.watch(h.stop.signal);
  t.after(async () => { h.stop.abort(); await worker; });

  const guest = await fetch(h.base + "/v1/guest-sessions", { method: "POST" }); // auth/tokens.ts createGuest
  assert.equal(guest.status, 201);
  const session = await guest.json();
  assert.equal(typeof session.token, "string");
  assert.ok(Date.parse(session.expiresAt) > Date.now());
  const api = client(h.base, session.token);

  const created = await api.createConversation();
  assert.equal(created.status, 201, created.text);
  validate("Conversation", created.json);
  const conversationId = created.json.id;

  // voice.ts / files.ts: Chrome records webm, the Interface uploads the raw blob with the normalised type.
  const uploaded = await api.uploadFile(WEBM, "audio/webm");
  assert.equal(uploaded.status, 201, uploaded.text);
  validate("File", uploaded.json);
  assert.equal(uploaded.json.mimeType, "audio/webm");

  const stream = await openStream(api, conversationId);
  assert.match(stream.ticket.url, /^ws:\/\/127\.0\.0\.1:\d+\/v1\/stream\?ticket=/);

  const input = { id: identifier("msg"), content: { type: "audio", fileId: uploaded.json.id }, sentAt: new Date().toISOString() };
  const accepted = await api.sendMessage(conversationId, input);
  assert.equal(accepted.status, 202, accepted.text);
  assert.deepEqual(accepted.json, { messageId: input.id, conversationId, status: "accepted" });
  // The same POST again (retry with the same id/Idempotency-Key) replays the answer.
  const replayed = await api.sendMessage(conversationId, input);
  assert.equal(replayed.status, 202);
  assert.deepEqual(replayed.json, accepted.json);

  await until(() => stream.frames.some((frame) => frame.data.kind === "message.sent"));
  const kinds = stream.frames.map((frame) => frame.data.kind);
  assert.deepEqual(kinds.slice(0, 2), ["message.received", "message.received"]);
  assert.equal(kinds.at(-1), "message.sent");
  assert.ok(kinds.slice(2, -1).length > 1 && kinds.slice(2, -1).every((kind) => kind === "message.delta"), kinds.join(","));

  const [first, second] = stream.frames;
  assert.equal(first.data.message.id, input.id);
  assert.deepEqual(first.data.message.content, input.content);
  // The Interface rebuilds the vocal line from message.transcript (conversation-state.ts applyUserMessage).
  assert.equal(second.data.message.id, input.id);
  assert.equal(second.data.message.transcript, TRANSCRIPT);

  // Provider got the real recording as multipart webm with the bearer key.
  assert.equal(h.transcriptionCalls.length, 1);
  assert.equal(h.transcriptionCalls[0].authorization, "Bearer synthetic-transcription-key");
  assert.ok(h.transcriptionCalls[0].raw.includes(WEBM));
  assert.match(h.transcriptionCalls[0].raw.toString("latin1"), /filename="recording\.webm"/);
  // The model answered the transcript, not the audio reference.
  assert.equal(h.modelCalls.length, 1);
  assert.equal(h.modelCalls[0].stream, true);
  assert.equal(h.modelCalls[0].messages.at(-1).content, TRANSCRIPT);

  const sent = stream.frames.at(-1);
  const deltas = stream.frames.filter((frame) => frame.data.kind === "message.delta");
  validate("Event", sent);
  const finalText = sent.data.message.blocks.filter((block) => block.type === "text").map((block) => block.text).join("");
  assert.equal(finalText, REPLY);
  assert.ok(deltas.every((frame) => frame.type === "bj.techma.message.delta.v2" && frame.data.messageId === sent.data.message.id));
  assert.deepEqual(deltas.map((frame) => frame.data.index), deltas.map((_, index) => index));
  assert.ok(deltas.some((frame) => frame.data.delta.trim().includes(" ")), "at least one delta carries several words");
  assert.equal(assemble(stream.frames, sent.data.message.id), finalText);
  assert.equal(new Set(stream.frames.map((frame) => frame.id)).size, stream.frames.length);

  // Reload: history has complete messages only, the transcript included, never a delta.
  const history = await api.listEvents(conversationId);
  assert.equal(history.status, 200);
  assert.deepEqual(history.json.items.map((event) => event.data.kind), ["message.received", "message.received", "message.sent"]);
  assert.equal(history.json.items[0].data.message.transcript, TRANSCRIPT);

  // Drop after the first delta, reconnect with the last cursor seen: the rest arrives, nothing is lost or repeated.
  stream.socket.close(1000);
  await stream.closed;
  const second_input = { id: identifier("msg"), content: { type: "text", text: "Merci." }, sentAt: new Date().toISOString() };
  const secondStream = await openStream(api, conversationId, { cursor: sent.id });
  assert.equal((await api.sendMessage(conversationId, second_input)).status, 202);
  await until(() => secondStream.frames.some((frame) => frame.data.kind === "message.sent"));
  const resumed = secondStream.frames;
  assert.equal(resumed[0].data.kind, "message.received");
  assert.equal(resumed[0].data.message.id, second_input.id);
  const resumedSent = resumed.at(-1);
  const resumedDeltas = resumed.filter((frame) => frame.data.kind === "message.delta");
  assert.ok(resumedDeltas.length > 0);
  assert.equal(assemble(resumed, resumedSent.data.message.id), REPLY);
  // Reconnect again in the middle of that answer's events: replay from its first delta covers the tail.
  secondStream.socket.close(1000);
  await secondStream.closed;
  const tail = await openStream(api, conversationId, { cursor: resumedDeltas[0].id });
  await until(() => tail.frames.some((frame) => frame.data.kind === "message.sent"));
  assert.deepEqual(tail.frames.map((frame) => frame.id), resumed.slice(resumed.indexOf(resumedDeltas[0]) + 1).map((frame) => frame.id));
  tail.socket.close(1000);
  await tail.closed;

  // A spent ticket cannot be reused, an unknown cursor is a clean REPLAY_EXPIRED close the Interface handles.
  const expired = await openStream(api, conversationId, { cursor: "evt_" + "0".repeat(26) });
  assert.deepEqual(await expired.closed, { code: 1008, reason: "REPLAY_EXPIRED" });
  const reuse = new WebSocket(stream.ticket.url, { origin: FRONT_ORIGIN });
  const refused = await new Promise((resolve) => { reuse.once("unexpected-response", (_req, res) => resolve(res.statusCode)); reuse.once("error", () => {}); });
  assert.equal(refused, 401);
});

test("WebSocket origin: the Interface origin and its loopback aliases are accepted, others refused", async (t) => {
  assert.equal(socketOriginAllowed(FRONT_ORIGIN, [FRONT_ORIGIN]), true);
  assert.equal(socketOriginAllowed("http://localhost:3000", [FRONT_ORIGIN]), true);
  assert.equal(socketOriginAllowed("http://localhost:3001", [FRONT_ORIGIN]), false);
  assert.equal(socketOriginAllowed("https://localhost:3000", [FRONT_ORIGIN]), false);
  assert.equal(socketOriginAllowed("http://evil.example:3000", [FRONT_ORIGIN]), false);
  assert.equal(socketOriginAllowed(undefined, [FRONT_ORIGIN]), false);
  assert.equal(socketOriginAllowed("http://localhost:3000", ["https://assistant.example.bj"]), false);

  const h = await harness(t);
  const guest = await (await fetch(h.base + "/v1/guest-sessions", { method: "POST" })).json();
  const api = client(h.base, guest.token);
  const conversationId = (await api.createConversation()).json.id;
  const alias = await openStream(api, conversationId, { origin: "http://localhost:3000" });
  alias.socket.close(1000);
  await alias.closed;
  await assert.rejects(openStream(api, conversationId, { origin: "http://evil.example" }), (error) => error.status === 401);
  await assert.rejects(openStream(api, conversationId, { origin: null }), (error) => error.status === 401);
});

test("voice message without a transcription key says so instead of a generic failure", async (t) => {
  const h = await harness(t);
  const agent = h.makeAgent(false);
  const guest = await (await fetch(h.base + "/v1/guest-sessions", { method: "POST" })).json();
  const api = client(h.base, guest.token);
  const conversationId = (await api.createConversation()).json.id;
  const uploaded = await api.uploadFile(WEBM, "audio/webm");
  const input = { id: identifier("msg"), content: { type: "audio", fileId: uploaded.json.id }, sentAt: new Date().toISOString() };
  assert.equal((await api.sendMessage(conversationId, input)).status, 202);
  await agent.process(conversationId);
  const events = (await api.listEvents(conversationId)).json.items;
  assert.deepEqual(events.map((event) => event.data.kind), ["message.received", "message.sent"]);
  assert.equal(events[0].data.message.transcript, null);
  assert.match(events[1].data.message.blocks[0].text, /transcription des messages vocaux n’est pas disponible/);
  assert.equal(h.modelCalls.length, 0);
  assert.equal(h.transcriptionCalls.length, 0);
});

test("upload limits and types as the Interface triggers them (413, 415, empty body)", async (t) => {
  const h = await harness(t);
  const guest = await (await fetch(h.base + "/v1/guest-sessions", { method: "POST" })).json();
  const api = client(h.base, guest.token);
  const problem = (result, status, code) => {
    assert.equal(result.status, status, result.text);
    assert.match(result.headers.get("content-type"), /application\/problem\+json/);
    assert.equal(result.json.code, code);
    assert.equal(result.json.status, status);
    assert.match(result.json.traceId, /^[a-f0-9]{32}$/);
  };
  problem(await api.uploadFile(WEBM, "audio/wav"), 415, "UNSUPPORTED_MEDIA_TYPE");
  problem(await api.uploadFile(Buffer.alloc(0), "audio/webm"), 400, "INVALID_REQUEST");
  problem(await api.uploadFile(Buffer.alloc(10485761, 1), "application/pdf"), 413, "FILE_TOO_LARGE");
  for (const mime of ["audio/ogg", "audio/mp4", "audio/mpeg", "application/pdf", "image/jpeg", "image/png", "audio/webm"]) {
    const ok = await api.uploadFile(Buffer.from("%PDF-1.4 x"), mime);
    assert.equal(ok.status, 201, mime + " " + ok.text);
  }
  const noAuth = await client(h.base).uploadFile(WEBM, "audio/webm");
  problem(noAuth, 401, "UNAUTHORIZED");
});

test("attach with the guest token (auth/callback): conversations follow the account and the agent resumes after login", async (t) => {
  const h = await harness(t);
  const guest = await (await fetch(h.base + "/v1/guest-sessions", { method: "POST" })).json();
  const guestApi = client(h.base, guest.token);
  const conversationId = (await guestApi.createConversation()).json.id;
  const second = (await guestApi.createConversation()).json.id;
  // The previous turn asked for a login (what the Backend does for request.create as a guest).
  const owner = (await h.pool.query("SELECT user_ref FROM backend_conversations WHERE id=$1", [conversationId])).rows[0].user_ref;
  const input = { id: identifier("msg"), content: { type: "text", text: "Je veux déposer une demande." }, sentAt: new Date().toISOString() };
  assert.equal((await guestApi.sendMessage(conversationId, input)).status, 202);
  await h.pool.query("UPDATE backend_messages SET processed_at=now() WHERE conversation_id=$1", [conversationId]);
  await transaction(h.pool, (db) => h.conversations.complete(db, conversationId, input.id, [{ type: "loginRequired", reason: "Connectez-vous pour déposer ce dossier." }], traceparent()));

  const userToken = await h.citizen("keycloak-aminata");
  // auth/callback/route.ts attachGuest(): Bearer user token, JSON body {guestToken}, no Idempotency-Key.
  const attach = await fetch(`${h.base}/v1/conversations/${conversationId}/attach`, {
    method: "POST",
    headers: { authorization: `Bearer ${userToken}`, "content-type": "application/json" },
    body: JSON.stringify({ guestToken: guest.token }),
  });
  assert.equal(attach.status, 200, await attach.clone().text());
  const attached = await attach.json();
  validate("Conversation", attached);
  assert.equal(attached.id, conversationId);
  assert.equal(attached.authenticated, true);
  // Retried callback: same answer.
  const again = await fetch(`${h.base}/v1/conversations/${conversationId}/attach`, {
    method: "POST",
    headers: { authorization: `Bearer ${userToken}`, "content-type": "application/json" },
    body: JSON.stringify({ guestToken: guest.token }),
  });
  assert.equal(again.status, 200);

  const userApi = client(h.base, userToken);
  const listed = await userApi.call("GET", "/v1/conversations");
  assert.equal(listed.status, 200);
  assert.deepEqual(new Set(listed.json.items.map((item) => item.id)), new Set([conversationId, second]));
  // The browser resumes with the user session: history is readable, the guest token is spent.
  const history = await userApi.listEvents(conversationId);
  assert.equal(history.status, 200);
  assert.deepEqual(history.json.items.map((event) => event.data.kind), ["message.received", "message.sent"]);
  assert.equal((await guestApi.listEvents(conversationId)).status, 403);
  const rejected = await fetch(`${h.base}/v1/conversations/${conversationId}/attach`, {
    method: "POST",
    headers: { authorization: `Bearer ${await h.citizen("someone-else")}`, "content-type": "application/json" },
    body: JSON.stringify({ guestToken: guest.token }),
  });
  assert.equal(rejected.status, 409);

  // The login was what the conversation waited for: the agent picks it up without a new message from the user.
  const pending = (await h.pool.query("SELECT body FROM backend_messages WHERE conversation_id=$1 AND processed_at IS NULL", [conversationId])).rows;
  assert.equal(pending.length, 1);
  assert.equal(pending[0].body.content.text, RESUME_AFTER_LOGIN);
  const kindsBefore = (await userApi.listEvents(conversationId)).json.items.map((event) => event.data.kind);
  assert.deepEqual(kindsBefore, ["message.received", "message.sent"], "the resume turn is never shown as a user message");
  h.behaviour.model = () => "Vous êtes connecté, nous pouvons continuer.";
  await h.agent.process(conversationId);
  const after = (await userApi.listEvents(conversationId)).json.items;
  assert.deepEqual(after.map((event) => event.data.kind), ["message.received", "message.sent", "message.sent"]);
  assert.equal(h.modelCalls.at(-1).messages.at(-1).content, RESUME_AFTER_LOGIN);
  void owner;
});

test("a file answering a fileRequest block reaches the agent as an opaque attach instruction", async (t) => {
  const h = await harness(t);
  const guest = await (await fetch(h.base + "/v1/guest-sessions", { method: "POST" })).json();
  const api = client(h.base, guest.token);
  const conversationId = (await api.createConversation()).json.id;
  const requestId = identifier("req");
  await transaction(h.pool, (db) => h.conversations.complete(db, conversationId, identifier("msg"), [
    { type: "fileRequest", requestId, documentType: "extrait-acte-naissance", label: "Extrait d’acte de naissance", acceptedMimeTypes: ["application/pdf"], received: false },
  ], traceparent()));
  const uploaded = await api.uploadFile(Buffer.from("%PDF-1.4 piece"), "application/pdf");
  // use-conversation.ts: { type: 'file', fileId, documentType } from the fileRequest line.
  const input = { id: identifier("msg"), content: { type: "file", fileId: uploaded.json.id, documentType: "extrait-acte-naissance" }, sentAt: new Date().toISOString() };
  assert.equal((await api.sendMessage(conversationId, input)).status, 202);
  h.behaviour.model = () => "Pièce reçue, je la rattache au brouillon.";
  await h.agent.process(conversationId);
  const prompt = h.modelCalls.at(-1).messages.at(-1).content;
  assert.ok(prompt.includes(requestId) && prompt.includes(uploaded.json.id) && prompt.includes("extrait-acte-naissance"), prompt);
  // A free file (documentType null) keeps the plain acknowledgement.
  const free = await api.uploadFile(Buffer.from("%PDF-1.4 libre"), "application/pdf");
  const freeInput = { id: identifier("msg"), content: { type: "file", fileId: free.json.id, documentType: null }, sentAt: new Date().toISOString() };
  assert.equal((await api.sendMessage(conversationId, freeInput)).status, 202);
  const calls = h.modelCalls.length;
  await h.agent.process(conversationId);
  assert.equal(h.modelCalls.length, calls);
});

test("issued document downloads carry a filename for the browser", () => {
  const documents = [{ id: "doc_01JD0000000000000000000002", kind: "issued", documentType: "casier-b3", name: "Extrait B3 du casier judiciaire", mimeType: "application/pdf", sizeBytes: 10, createdAt: "2026-11-02T10:00:00Z" }];
  const header = documentDisposition(documents, "doc_01JD0000000000000000000002", "application/pdf");
  assert.equal(header, `attachment; filename="Extrait B3 du casier judiciaire.pdf"; filename*=UTF-8''Extrait%20B3%20du%20casier%20judiciaire.pdf`);
  assert.match(documentDisposition([{ ...documents[0], name: "Acte de naissance « é »\r\n\"x\"" }], documents[0].id, "image/png"), /^attachment; filename="Acte de naissance [^"\r\n]*\.png"; filename\*=UTF-8''[A-Za-z0-9%._-]+$/);
  assert.equal(documentDisposition([], "doc_x", "application/pdf"), `attachment; filename="document.pdf"; filename*=UTF-8''document.pdf`);
});
