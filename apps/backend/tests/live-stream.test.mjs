// Real-time streaming of the reply (CONTRACTS.md §7.1 points 3-7): message.delta is written and pushed WHILE the
// model generates, message.sent stays the source of truth. The model is a local fake SSE server that emits its
// words slowly (no real provider, no secret); everything else is the real Agent, HttpModels, Postgres and sockets.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { performance } from "node:perf_hooks";
import { readFileSync } from "node:fs";
import { WebSocket } from "ws";
import { isolatedDatabase } from "./helpers.mjs";
import { database, migrate, provision } from "../dist/apps/backend/src/database.js";
import { identifier } from "../dist/apps/backend/src/domain.js";
import { Conversations } from "../dist/apps/backend/src/conversations.js";
import { Agent } from "../dist/apps/backend/src/agent.js";
import { HttpModels } from "../dist/apps/backend/src/model.js";
import { attachSockets } from "../dist/apps/backend/src/sockets.js";
import { LiveReply, DELTA_FLUSH_MS } from "../dist/apps/backend/src/live-reply.js";
import { catalog } from "../dist/apps/backend/src/tooling.js";
import { UNAVAILABLE_BLOCKS } from "../dist/apps/backend/src/model-reply.js";

const fixtures = JSON.parse(readFileSync(new URL("../../../contracts/v2/examples.json", import.meta.url)));
const procedure = fixtures.schemas.Procedure;
const tp = "00-" + "1".repeat(32) + "-" + "2".repeat(16) + "-01";
const ORIGIN = "https://portal.example.test";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sse = (res, delta) => res.write(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`);

const GAP_MS = 200; // 15 words x 200 ms: the fake model generates for about 3 s
// No digit: a number without a source would make the validation refuse the reply.
const SLOW_TEXT = "Bonjour voici votre réponse écrite mot après mot pendant que le modèle génère le texte";
const WORDS = SLOW_TEXT.split(" ").length;

/** Splits the model envelope around the text value, like a provider streaming word after word. */
function envelope(text, sources = []) {
  const json = JSON.stringify({ blocks: [{ type: "text", text, sources }] });
  const start = json.indexOf(text);
  const words = text.split(/(?<= )/);
  return { head: json.slice(0, start), words, tail: json.slice(start + text.length) };
}

async function harness(t) {
  const pg = await isolatedDatabase();
  const pool = database(pg.connection);
  const conversations = new Conversations(pool);
  const timing = { requests: [], ends: [] };
  const behaviour = { reply: async (_body, res) => { await slowText(res, SLOW_TEXT); } };
  const modelServer = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    timing.requests.push(performance.now());
    await behaviour.reply(body, res, timing.requests.length);
    timing.ends.push(performance.now());
  });
  await new Promise((resolve) => modelServer.listen(0, "127.0.0.1", resolve));
  const socketServer = http.createServer();
  const closeSockets = attachSockets(socketServer, conversations, [ORIGIN]);
  await new Promise((resolve) => socketServer.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    closeSockets();
    for (const server of [modelServer, socketServer]) {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
    delete process.env.LIVE_STREAM_KEY;
    await pool.end();
    await pg.close();
  });
  await migrate(pool);
  process.env.LIVE_STREAM_KEY = "synthetic-model-key";
  await provision(pool, "global", "models", {
    id: "live", label: "Faux modèle lent", baseUrl: `http://127.0.0.1:${modelServer.address().port}/v1`,
    protocol: "chat-completions", model: "synthetic", apiKeyRef: "LIVE_STREAM_KEY", temperature: 0, active: true,
  });
  await pool.query("INSERT INTO backend_mcp_servers(administration_id,id,body) VALUES('global','tooling',$1)", [JSON.stringify({ id: "tooling", name: "Tooling", url: "http://127.0.0.1:9999/mcp", enabled: true, transport: "streamable-http", auth: { type: "bearer", secretRef: "backend-agent" }, policy: "techma" })]);
  for (const tool of catalog)
    await pool.query("INSERT INTO backend_mcp_tools(administration_id,server_id,name,definition,available,enabled,requires_mandate) VALUES('global','tooling',$1,$2,true,true,$3)", [tool.name, tool, Boolean(tool._meta?.["bj.techma/requiresMandate"])]);
  const toolCalls = [];
  const tooling = {
    async discover() { return catalog; },
    async call(_url, _auth, name) {
      toolCalls.push(name);
      return { structuredContent: procedure, content: [{ type: "text", text: JSON.stringify(procedure) }] };
    },
  };
  const user = { userRef: identifier("usr"), channel: "web", authenticated: true, expiresAt: Date.now() + 120000, roles: new Set() };
  const agent = new Agent(pool, conversations, new HttpModels({}), tooling);
  return { pool, conversations, agent, user, timing, behaviour, toolCalls, socketPort: socketServer.address().port };
}

/** SSE answer streaming `text` word by word, GAP_MS apart (the envelope head goes with the first word). */
async function slowText(res, text, sources = [], gap = GAP_MS) {
  const { head, words, tail } = envelope(text, sources);
  res.writeHead(200, { "content-type": "text/event-stream" });
  for (let index = 0; index < words.length; index++) {
    sse(res, { content: (index === 0 ? head : "") + words[index] });
    await sleep(gap);
  }
  sse(res, { content: tail });
  res.end("data: [DONE]\n\n");
}

async function ask(h, text = "Bonjour") {
  const conversation = await h.conversations.create(h.user, { locale: "fr" }, identifier("key"));
  const message = { id: identifier("msg"), content: { type: "text", text }, sentAt: new Date().toISOString() };
  await h.conversations.accept(h.user, conversation.id, message, identifier("key"), tp);
  const received = (await h.conversations.page(h.user.userRef, conversation.id)).items[0];
  return { conversation, message, received };
}

/** What the browser sees: WebSocket frames AND a GET …/events-with-cursor poller, each with its arrival time. */
async function watch(h, conversationId, cursor) {
  const frames = [];
  const polled = [];
  const ticket = await h.conversations.ticket(h.user, conversationId, identifier("key"), `ws://127.0.0.1:${h.socketPort}/v1/stream`);
  const ws = new WebSocket(ticket.url + "&cursor=" + encodeURIComponent(cursor), { origin: ORIGIN });
  ws.on("message", (data) => frames.push({ at: performance.now(), event: JSON.parse(data.toString()) }));
  await once(ws, "open");
  let polling = true;
  let after = cursor;
  const poller = (async () => {
    while (polling) {
      const page = await h.conversations.page(h.user.userRef, conversationId, after);
      for (const event of page.items) polled.push({ at: performance.now(), event });
      after = page.nextCursor ?? after;
      await sleep(100);
    }
  })();
  return {
    frames, polled,
    async stop() {
      polling = false;
      await poller;
      ws.close();
      await once(ws, "close");
    },
  };
}

const kinds = (list) => list.map((item) => item.event.data.kind);
const textOf = (message) => message.blocks.filter((block) => block.type === "text").map((block) => block.text).join("");

test("deltas reach the browser while the model is still generating (WebSocket and GET with cursor)", async (t) => {
  const h = await harness(t);
  const { conversation, received } = await ask(h);
  const view = await watch(h, conversation.id, received.id);
  const started = performance.now();
  await h.agent.process(conversation.id);
  await sleep(300);
  await view.stop();

  const generationEnd = h.timing.ends[0];
  const generationMs = generationEnd - h.timing.requests[0];
  assert.ok(generationMs > 2800, `the fake model really takes ${Math.round(generationMs)} ms`);

  for (const [label, list] of [["WebSocket", view.frames], ["GET events?cursor", view.polled]]) {
    const deltas = list.filter((item) => item.event.data.kind === "message.delta");
    const sent = list.find((item) => item.event.data.kind === "message.sent");
    assert.ok(sent, label + ": message.sent received");
    // The last word waits for the end of the stream and "mot " waits for the next word (it may start "mot de passe").
    assert.ok(deltas.length >= WORDS - 3, `${label}: ${deltas.length} deltas`);
    const first = deltas[0].at - started;
    const firstBeforeEnd = generationEnd - deltas[0].at;
    t.diagnostic(`${label}: first delta +${Math.round(first)} ms, model finished +${Math.round(generationEnd - started)} ms, message.sent +${Math.round(sent.at - started)} ms, last delta +${Math.round(deltas.at(-1).at - started)} ms`);
    assert.ok(first < 1000, `${label}: first delta after ${Math.round(first)} ms (< 1000)`);
    assert.ok(firstBeforeEnd > 2400, `${label}: first delta only ${Math.round(firstBeforeEnd)} ms before the end of the generation`);
    assert.ok(deltas.at(-1).at - deltas[0].at > 2000, label + ": deltas are spread over the generation, not grouped");
    // Half of the text is on screen before the model has finished.
    assert.ok(deltas.filter((item) => item.at < generationEnd - 600).length >= WORDS / 2, label + ": most deltas arrive before the end");
    assert.ok(sent.at >= generationEnd - 20, label + ": message.sent closes after the generation");
    assert.ok(deltas.every((item) => item.at <= sent.at), label + ": no delta after message.sent");
    assert.deepEqual(deltas.map((item) => item.event.data.index), deltas.map((_, index) => index), label + ": indexes 0-based, increasing");
    const messageId = sent.event.data.message.id;
    assert.ok(deltas.every((item) => item.event.data.messageId === messageId && item.event.type === "bj.techma.message.delta.v2"));
    assert.equal(deltas.map((item) => item.event.data.delta).join(""), SLOW_TEXT);
    assert.equal(textOf(sent.event.data.message), SLOW_TEXT);
    assert.equal(new Set(list.map((item) => item.event.id)).size, list.length, label + ": no event twice");
  }

  // Reloading never shows a delta, only the validated final message.
  const history = await h.conversations.page(h.user.userRef, conversation.id);
  assert.deepEqual(history.items.map((event) => event.data.kind), ["message.received", "message.sent"]);
  const stored = (await h.pool.query("SELECT body->'data'->>'kind' AS kind, expires_at='infinity'::timestamptz AS durable FROM backend_conversation_events WHERE conversation_id=$1 ORDER BY seq", [conversation.id])).rows;
  assert.ok(stored.filter((row) => row.kind === "message.delta").every((row) => row.durable === false), "deltas are never durable history");

  // A client that dropped in the middle resumes from the last event it saw: the tail, in order, nothing lost.
  const allDeltas = view.frames.filter((item) => item.event.data.kind === "message.delta");
  const resumeFrom = allDeltas[4].event;
  const tail = await h.conversations.page(h.user.userRef, conversation.id, resumeFrom.id);
  assert.deepEqual(tail.items.map((event) => event.data.kind), [...allDeltas.slice(5).map(() => "message.delta"), "message.sent"]);
  assert.deepEqual(tail.items.filter((event) => event.data.kind === "message.delta").map((event) => event.data.index), allDeltas.slice(5).map((_, index) => index + 5));
});

test("tool turn then final text: only the final turn is streamed", async (t) => {
  const h = await harness(t);
  h.behaviour.reply = async (body, res) => {
    if (body.messages.at(-1).role === "tool") {
      await slowText(res, SLOW_TEXT, [procedure.source]);
      return;
    }
    // Tool turn: prose before the call, the call, then envelope text that must never reach the user.
    res.writeHead(200, { "content-type": "text/event-stream" });
    sse(res, { content: "Je consulte le catalogue. " });
    await sleep(60);
    sse(res, { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "procedures_get", arguments: "" } }] });
    sse(res, { content: JSON.stringify({ blocks: [{ type: "text", text: "NE PAS MONTRER", sources: [] }] }) });
    sse(res, { tool_calls: [{ index: 0, function: { arguments: JSON.stringify({ procedureId: procedure.id }) } }] });
    await sleep(200);
    res.end("data: [DONE]\n\n");
  };
  const { conversation, received } = await ask(h);
  const view = await watch(h, conversation.id, received.id);
  const started = performance.now();
  await h.agent.process(conversation.id);
  await sleep(300);
  await view.stop();

  assert.deepEqual(h.toolCalls, ["procedures.get"]);
  assert.equal(h.timing.requests.length, 2);
  const deltas = view.frames.filter((item) => item.event.data.kind === "message.delta");
  const sent = view.frames.find((item) => item.event.data.kind === "message.sent");
  const joined = deltas.map((item) => item.event.data.delta).join("");
  assert.equal(joined, SLOW_TEXT);
  assert.equal(joined.includes("NE PAS MONTRER") || joined.includes("consulte"), false);
  assert.deepEqual(deltas.map((item) => item.event.data.index), deltas.map((_, index) => index));
  // Streamed during the second (final) generation, not after it.
  assert.ok(deltas[0].at > h.timing.requests[1] - 20, "no delta before the final turn starts");
  assert.ok(h.timing.ends[1] - deltas[0].at > 2400, "first delta well before the end of the final generation");
  assert.ok(deltas[0].at - h.timing.requests[1] < 700);
  assert.ok(sent.at >= h.timing.ends[1] - 20);
  assert.equal(textOf(sent.event.data.message), SLOW_TEXT);
  assert.deepEqual(sent.event.data.message.blocks[0].sources, [procedure.source]);
  assert.equal(JSON.stringify(sent.event.data.message).includes("NE PAS MONTRER"), false);
  t.diagnostic(`final turn: first delta +${Math.round(deltas[0].at - h.timing.requests[1])} ms after the second request; total +${Math.round(sent.at - started)} ms`);
});

test("invalid streamed text is replaced by the validated message.sent; retries stay silent", async (t) => {
  const h = await harness(t);
  const draft = "Le tarif est de 15000 FCFA pour tous les usagers";
  h.behaviour.reply = async (_body, res, count) => { await slowText(res, draft, [], count === 1 ? GAP_MS : 5); };
  const { conversation, received } = await ask(h);
  const view = await watch(h, conversation.id, received.id);
  await h.agent.process(conversation.id);
  await sleep(300);
  await view.stop();

  assert.equal(h.timing.requests.length, 3, "three attempts, the fact has no source");
  const deltas = view.frames.filter((item) => item.event.data.kind === "message.delta");
  const sent = view.frames.find((item) => item.event.data.kind === "message.sent");
  // The first attempt streamed live; the retries were not streamed again on top of it.
  assert.equal(deltas.map((item) => item.event.data.delta).join(""), draft);
  assert.deepEqual(deltas.map((item) => item.event.data.index), deltas.map((_, index) => index));
  assert.ok(deltas.at(-1).at < h.timing.requests[1] + 100, "all deltas come from the first attempt");
  // message.sent is the validated answer and replaces the draft: it does not contain the unvalidated claim.
  assert.deepEqual(sent.event.data.message.blocks, UNAVAILABLE_BLOCKS);
  assert.equal(JSON.stringify(sent.event.data.message).includes("15000"), false);
  const history = await h.conversations.page(h.user.userRef, conversation.id);
  assert.equal(JSON.stringify(history.items).includes("15000"), false, "reloaded history never contains the unvalidated text");
  assert.deepEqual(history.items.map((event) => event.data.kind), ["message.received", "message.sent"]);
});

test("a provider stream that breaks mid-text is retried without replaying the text already streamed", async (t) => {
  const h = await harness(t);
  h.behaviour.reply = async (_body, res, count) => {
    if (count === 1) {
      const { head, words } = envelope("Bonjour et bienvenue sur le portail");
      res.writeHead(200, { "content-type": "text/event-stream" });
      sse(res, { content: head + words[0] });
      await sleep(120);
      sse(res, { content: words[1] });
      await sleep(120);
      res.write('data: {"choices":[{"delta":{"content":'); // cut mid-event
      res.destroy();
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ blocks: [{ type: "text", text: "Bonjour et bienvenue sur le portail", sources: [] }] }) } }] }));
  };
  const { conversation, received } = await ask(h);
  const view = await watch(h, conversation.id, received.id);
  await h.agent.process(conversation.id);
  await sleep(300);
  await view.stop();
  const deltas = view.frames.filter((item) => item.event.data.kind === "message.delta");
  const sent = view.frames.find((item) => item.event.data.kind === "message.sent");
  assert.equal(deltas.map((item) => item.event.data.delta).join(""), "Bonjour et ");
  assert.deepEqual(deltas.map((item) => item.event.data.index), deltas.map((_, index) => index));
  assert.equal(textOf(sent.event.data.message), "Bonjour et bienvenue sur le portail");
});

test("replay after a worker crash does not stream a second draft; message.sent still closes the reply", async (t) => {
  const h = await harness(t);
  const { conversation, received } = await ask(h);
  // First run: some text was streamed, then the process dies before message.sent.
  const crashing = {
    async generate(_config, _history, _tools, options) {
      const { head, words } = envelope("Bonjour et bienvenue");
      options.onTextDelta(head + words[0]);
      await sleep(80);
      options.onTextDelta(words[1]);
      await sleep(80);
      throw Object.assign(new Error("crash"), { status: 503 });
    },
  };
  await assert.rejects(new Agent(h.pool, h.conversations, crashing, { async discover() { return []; }, async call() { throw new Error("unused"); } }).process(conversation.id));
  const before = (await h.conversations.page(h.user.userRef, conversation.id, received.id)).items;
  assert.deepEqual(before.map((event) => event.data.kind), ["message.delta", "message.delta"]);
  assert.deepEqual(before.map((event) => event.data.delta), ["Bonjour ", "et "]);

  const view = await watch(h, conversation.id, before.at(-1).id);
  await h.agent.process(conversation.id); // the worker comes back: the model now answers in full
  await sleep(300);
  await view.stop();
  assert.deepEqual(kinds(view.frames), ["message.sent"], "no second draft, no duplicated or re-indexed delta");
  const all = (await h.conversations.page(h.user.userRef, conversation.id, received.id)).items;
  assert.deepEqual(all.filter((event) => event.data.kind === "message.delta").map((event) => event.data.index), [0, 1]);
  assert.equal(all.at(-1).data.message.id, before[0].data.messageId, "same messageId as the deltas");
  assert.deepEqual((await h.conversations.page(h.user.userRef, conversation.id)).items.map((event) => event.data.kind), ["message.received", "message.sent"]);
});

test("deltas are grouped within the flush window and settle() waits for every write", async () => {
  const written = [];
  const fake = {
    pool: { async query() { return { rows: [] }; } },
    async appendDelta(_cid, _mid, delta, index) { written.push({ at: performance.now(), delta, index }); await sleep(2); return 1; },
  };
  const live = new LiveReply(fake, "cnv", "msg", tp);
  const listener = await live.attempt();
  const start = performance.now();
  // 120 tiny provider pieces (one word each) over about 240 ms: well over the number of writes allowed.
  for (let index = 0; index < 120; index++) {
    listener.onTextDelta(index === 0 ? '{"blocks":[{"type":"text","text":"' : "x ");
    await sleep(2);
  }
  await live.settle();
  const elapsed = performance.now() - start;
  assert.equal(written.map((item) => item.delta).join(""), "x ".repeat(119));
  assert.deepEqual(written.map((item) => item.index), written.map((_, index) => index));
  assert.ok(written.length <= Math.ceil(elapsed / DELTA_FLUSH_MS) + 2, `${written.length} writes for ${Math.round(elapsed)} ms`);
  assert.ok(written[0].at - start < 30, "the first word is not held back");
  await live.close();
  const count = written.length;
  listener.onTextDelta("late");
  await live.settle();
  assert.equal(written.length, count, "nothing is written once closed");
});
