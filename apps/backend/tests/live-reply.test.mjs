import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { WebSocket } from "ws";
import { isolatedDatabase } from "./helpers.mjs";
import { database, migrate, provision } from "../dist/apps/backend/src/database.js";
import { identifier } from "../dist/apps/backend/src/domain.js";
import { Conversations } from "../dist/apps/backend/src/conversations.js";
import { transaction } from "../dist/apps/backend/src/transactions.js";
import { Agent } from "../dist/apps/backend/src/agent.js";
import { redact } from "../dist/apps/backend/src/model.js";
import { attachSockets } from "../dist/apps/backend/src/sockets.js";
import { TextDeltaExtractor, visibleText } from "../dist/apps/backend/src/text-deltas.js";

const tp = "00-" + "1".repeat(32) + "-" + "2".repeat(16) + "-01";

function waitFor(predicate, timeout = 1000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      if (predicate()) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - start > timeout) {
        clearInterval(timer);
        reject(new Error("timed out"));
      }
    }, 10);
  });
}

test("text extractor keeps only text-block values", () => {
  const payload = JSON.stringify({
    blocks: [
      { type: "text", text: "Voir la fiche.", sources: [{ title: "Casier", url: "https://service-public.bj/casier" }] },
      { type: "buttons", items: [{ id: "go", label: "Continuer" }] },
      { type: "form", id: "f", fields: [{ name: "n", label: "Nom", required: true, type: "text" }] },
      { type: "text", text: "Ligne 1\nIl dit \"ok\".", sources: [] },
    ],
  });
  const streamed = new TextDeltaExtractor();
  let visible = "";
  for (const character of payload) visible += streamed.push(character);
  assert.equal(visible, "Voir la fiche.Ligne 1\nIl dit \"ok\".");
  assert.equal(visible.includes("sources") || visible.includes("Continuer") || visible.includes("label"), false);

  const split = new TextDeltaExtractor();
  assert.equal(split.push('{"te'), "");
  assert.equal(split.push('xt":"Hi"}'), "Hi");

  assert.equal(visibleText([
    { type: "text", text: "A" },
    { type: "buttons" },
    { type: "text", text: "B" },
  ]), "AB");
  assert.equal(visibleText([{ type: "buttons" }]), "");
});

test("durable history, live deltas and socket push", async (t) => {
  const pg = await isolatedDatabase();
  const pool = database(pg.connection);
  const conversations = new Conversations(pool);
  t.after(async () => {
    await pool.end();
    await pg.close();
  });
  await migrate(pool);
  const user = {
    userRef: identifier("usr"),
    channel: "web",
    authenticated: true,
    expiresAt: Date.now() + 60000,
    roles: new Set(),
  };
  const conversation = await conversations.create(user, { locale: "fr" }, identifier("key"));
  const message = {
    id: identifier("msg"),
    content: { type: "text", text: "Bonjour" },
    sentAt: new Date().toISOString(),
  };
  await conversations.accept(user, conversation.id, message, identifier("key"), tp);
  const assistantId = identifier("msg");
  assert.equal(await conversations.appendDelta(conversation.id, assistantId, "", 0, tp), 0);
  await conversations.appendDelta(conversation.id, assistantId, "Bonjour ", 0, tp);
  await conversations.appendDelta(conversation.id, assistantId, "le Bénin.", 1, tp);
  const history = await conversations.page(user.userRef, conversation.id);
  assert.deepEqual(history.items.map((event) => event.data.kind), ["message.received"]);
  const live = await conversations.page(user.userRef, conversation.id, history.items[0].id);
  assert.deepEqual(live.items.map((event) => event.data.kind), ["message.delta", "message.delta"]);
  assert.deepEqual(live.items.map((event) => event.data.delta), ["Bonjour ", "le Bénin."]);
  assert.deepEqual(live.items.map((event) => event.data.index), [0, 1]);
  assert.ok(live.items.every((event) => event.data.messageId === assistantId && event.type === "bj.techma.message.delta.v2"));
  const oversized = "x".repeat(8001);
  const parts = await conversations.appendDelta(conversation.id, assistantId, oversized, 2, tp);
  assert.equal(parts, 2);

  const sent = await transaction(pool, (db) => conversations.complete(
    db,
    conversation.id,
    message.id,
    [{ type: "text", text: "Bonjour le Bénin.", sources: [] }],
    tp,
    false,
    assistantId,
  ));
  assert.equal(sent.data.kind, "message.sent");
  assert.equal(sent.data.message.id, assistantId);
  const reloaded = await conversations.page(user.userRef, conversation.id);
  assert.deepEqual(reloaded.items.map((event) => event.data.kind), ["message.received", "message.sent"]);
  assert.equal(reloaded.items.at(-1).data.message.id, assistantId);
  const withCursor = await conversations.page(user.userRef, conversation.id, reloaded.items[0].id);
  assert.deepEqual(withCursor.items.map((event) => event.data.kind), [
    "message.delta",
    "message.delta",
    "message.delta",
    "message.delta",
    "message.sent",
  ]);
  assert.ok(withCursor.items.at(-1).id === sent.id);

  const durability = await pool.query(
    "SELECT body->'data'->>'kind' AS kind, expires_at = 'infinity'::timestamptz AS durable FROM backend_conversation_events WHERE conversation_id=$1",
    [conversation.id],
  );
  for (const row of durability.rows) {
    assert.equal(row.durable, row.kind === "message.received" || row.kind === "message.sent");
  }
  await pool.query(
    "UPDATE backend_conversation_events SET expires_at = now() - interval '48 hours' WHERE conversation_id=$1 AND expires_at < 'infinity'::timestamptz",
    [conversation.id],
  );
  const survived = await conversations.page(user.userRef, conversation.id);
  assert.deepEqual(survived.items.map((event) => event.data.kind), ["message.received", "message.sent"]);
  const afterExpiry = await conversations.page(user.userRef, conversation.id, survived.items[0].id);
  assert.deepEqual(afterExpiry.items.map((event) => event.data.kind), ["message.sent"]);
  assert.deepEqual((await conversations.page(user.userRef, conversation.id, survived.items.at(-1).id)).items, []);
  await assert.rejects(
    () => conversations.page(user.userRef, conversation.id, live.items[0].id),
    (error) => error.status === 410 && error.code === "REPLAY_EXPIRED",
  );

  await provision(pool, "global", "models", {
    id: "test",
    label: "Test",
    baseUrl: "https://api.groq.com/openai/v1",
    protocol: "chat-completions",
    model: "synthetic",
    apiKeyRef: "GROQ_API_KEY",
    temperature: 0,
    active: true,
  });
  const plain = "Bonjour à vous.";
  const rawEmail = "Écrivez à ada@exemple.bj merci.";
  const redactedEmail = redact(rawEmail);
  assert.notEqual(redactedEmail, rawEmail);
  const script = [
    async (options) => {
      // A tool turn: the provider announces the call first, so whatever text follows is never streamed.
      options.onToolCall();
      await options.onTextDelta(JSON.stringify({ blocks: [{ type: "text", text: "TEXTE DU TOUR OUTIL", sources: [] }] }));
      return { text: "", calls: [{ id: "call_1", name: "absent.tool", arguments: "{}" }] };
    },
    async (options) => {
      const body = JSON.stringify({ blocks: [{ type: "text", text: plain, sources: [] }] });
      const pieces = ['{"blocks":[{"type":"text","text":"', plain, '","sources":[]}]}'];
      assert.equal(pieces.join(""), body);
      for (const piece of pieces) await options.onTextDelta(piece);
      return { text: body, calls: [] };
    },
    async (options) => {
      const body = JSON.stringify({ blocks: [{ type: "text", text: rawEmail, sources: [] }] });
      // The provider cuts the address in two: "…ada@ex" | "emple.bj merci…".
      const cut = body.indexOf("ada@") + "ada@ex".length;
      for (const piece of [body.slice(0, cut), body.slice(cut)]) await options.onTextDelta(piece);
      return { text: body, calls: [] };
    },
    async (options) => {
      const body = JSON.stringify({ blocks: [{ type: "buttons", items: [{ id: "yes", label: "Oui" }] }] });
      await options.onTextDelta(body);
      return { text: body, calls: [] };
    },
  ];
  let step = 0;
  const model = {
    async generate(_config, _history, _tools, options) {
      const next = script[step++];
      assert.ok(next, "unexpected model call");
      return next(options);
    },
  };
  const tooling = { async discover() { return []; }, async call() { throw new Error("unused"); } };
  const agent = new Agent(pool, conversations, model, tooling);
  const thread = await conversations.create(user, { locale: "fr" }, identifier("key"));
  const inputs = [plain, rawEmail, "Montrez des boutons."];
  for (const text of inputs) {
    await conversations.accept(user, thread.id, {
      id: identifier("msg"),
      content: { type: "text", text },
      sentAt: new Date().toISOString(),
    }, identifier("key"), tp);
    await agent.process(thread.id);
  }
  assert.equal(step, script.length);
  const feed = await conversations.page(user.userRef, thread.id);
  assert.deepEqual(feed.items.map((event) => event.data.kind), [
    "message.received",
    "message.sent",
    "message.received",
    "message.sent",
    "message.received",
    "message.sent",
  ]);
  const traced = await conversations.page(user.userRef, thread.id, feed.items[0].id);
  assert.ok(traced.items.every((event) => event.data.kind !== "tool.called"));
  assert.equal((await pool.query(
    "SELECT count(*)::int AS n FROM backend_conversation_events WHERE conversation_id=$1 AND body->'data'->>'kind'='tool.called'",
    [thread.id],
  )).rows[0].n, 1);
  const sentEvents = feed.items.filter((event) => event.data.kind === "message.sent");
  assert.equal(sentEvents.length, 3);
  const [plainSent, emailSent, buttonSent] = sentEvents;
  const deltas = traced.items.filter((event) => event.data.kind === "message.delta");
  const plainDeltas = deltas.filter((event) => event.data.messageId === plainSent.data.message.id);
  const emailDeltas = deltas.filter((event) => event.data.messageId === emailSent.data.message.id);
  const buttonDeltas = deltas.filter((event) => event.data.messageId === buttonSent.data.message.id);
  // (a) The live flow carries what the model wrote, as it wrote it, under the messageId of the final message.
  assert.deepEqual(plainDeltas.map((event) => event.data.delta), [plain]);
  assert.equal(plainDeltas.map((event) => event.data.index).join(","), "0");
  assert.equal(emailDeltas.map((event) => event.data.delta).join(""), redactedEmail, "only masked text is streamed");
  assert.ok(emailDeltas.length >= 1);
  assert.ok(emailDeltas.every((event) => !/ada|@|exemple/.test(event.data.delta)), "no delta carries any part of the raw address");
  // (b) message.sent only carries validated, masked text and replaces the live draft.
  assert.equal(emailSent.data.message.blocks.filter((block) => block.type === "text").map((block) => block.text).join(""), redactedEmail);
  assert.equal(JSON.stringify(emailSent.data.message).includes("ada@exemple.bj"), false);
  assert.equal(emailDeltas.map((event) => event.data.delta).join(""), visibleText(emailSent.data.message.blocks));
  assert.equal(JSON.stringify(traced.items).includes("ada@"), false, "not even the live events (stored until expiry) hold the raw address");
  // (c) The reloaded history (no cursor) has neither deltas nor any unvalidated text.
  assert.equal(JSON.stringify(feed.items).includes("ada@exemple.bj"), false);
  assert.equal(JSON.stringify(feed.items).includes("TEXTE DU TOUR OUTIL"), false);
  assert.ok(feed.items.every((event) => event.data.kind !== "message.delta"));
  // Buttons-only reply: no text to stream, never a structured block in a delta.
  assert.equal(buttonDeltas.length, 0);
  assert.equal(buttonSent.data.message.blocks[0].type, "buttons");
  // A tool turn is never streamed.
  assert.ok(deltas.every((event) => !event.data.delta.includes("TEXTE DU TOUR OUTIL") && !event.data.delta.includes("\"type\"")));
  assert.ok(plainDeltas.every((event) => event.data.messageId === plainSent.data.message.id));

  const pushed = await conversations.create(user, { locale: "fr" }, identifier("key"));
  const pushedInput = {
    id: identifier("msg"),
    content: { type: "text", text: "Direct" },
    sentAt: new Date().toISOString(),
  };
  await conversations.accept(user, pushed.id, pushedInput, identifier("key"), tp);
  const pushedReceived = (await conversations.page(user.userRef, pushed.id)).items[0];
  const server = http.createServer();
  const closeSockets = attachSockets(server, conversations, ["https://portal.example.test"]);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => {
    closeSockets();
    server.close(resolve);
  }));
  let polls = 0;
  const originalPage = conversations.page.bind(conversations);
  conversations.page = async (...args) => {
    const result = await originalPage(...args);
    polls += 1;
    return result;
  };
  const address = server.address();
  assert.equal(typeof address, "object");
  const ticket = await conversations.ticket(
    user,
    pushed.id,
    identifier("key"),
    `http://127.0.0.1:${address.port}/v1/stream`,
  );
  const frames = [];
  const ws = new WebSocket(ticket.url + "&cursor=" + encodeURIComponent(pushedReceived.id), {
    origin: "https://portal.example.test",
  });
  ws.on("message", (data) => frames.push(JSON.parse(data.toString())));
  await once(ws, "open");
  await waitFor(() => polls >= 2);
  await new Promise((resolve) => setTimeout(resolve, 30));
  const pollsBefore = polls;
  const liveId = identifier("msg");
  await conversations.appendDelta(pushed.id, liveId, "Live ", 0, tp);
  // A live notification wakes the reader at once (well under the 250 ms idle poll) and the frame is read from the
  // stored events, so the cursor can never jump past an older event.
  await waitFor(() => frames.some((event) => event.data.kind === "message.delta"), 150);
  assert.ok(polls - pollsBefore <= 2, "live wake-ups are coalesced");
  assert.equal(frames.at(-1).data.delta, "Live ");
  assert.equal(frames.some((event) => event.data.kind === "message.sent"), false);
  const liveSent = await transaction(pool, (db) => conversations.complete(
    db,
    pushed.id,
    pushedInput.id,
    [{ type: "text", text: "Live ", sources: [] }],
    tp,
    false,
    liveId,
  ));
  conversations.emitLive(pushed.id, liveSent);
  await waitFor(() => frames.some((event) => event.data.kind === "message.sent"), 150);
  assert.ok(polls - pollsBefore <= 4, "live wake-ups are coalesced");
  const ids = frames.map((event) => event.id);
  assert.equal(new Set(ids).size, ids.length);
  const sentAt = frames.findIndex((event) => event.data.kind === "message.sent");
  const deltaAt = frames.findIndex((event) => event.data.kind === "message.delta");
  assert.ok(deltaAt >= 0 && deltaAt < sentAt);
  assert.equal(frames[sentAt].data.message.id, liveId);
  assert.equal(frames[deltaAt].data.messageId, liveId);
  ws.close();
  await once(ws, "close");
  conversations.page = originalPage;
});

test("accepted prose and fallback publish a delta before message.sent", async (t) => {
  const pg = await isolatedDatabase();
  const pool = database(pg.connection);
  const conversations = new Conversations(pool);
  t.after(async () => { await pool.end(); await pg.close(); });
  await migrate(pool);
  await provision(pool, "global", "models", {
    id: "test", label: "Test", baseUrl: "https://api.groq.com/openai/v1",
    protocol: "chat-completions", model: "synthetic", apiKeyRef: "GROQ_API_KEY", temperature: 0, active: true,
  });
  const user = { userRef: identifier("usr"), channel: "web", authenticated: true, expiresAt: Date.now() + 60000, roles: new Set() };
  const tooling = { async discover() { return []; }, async call() { throw new Error("unused"); } };
  let turn = 0;
  const model = {
    async generate(_config, _history, _tools, options) {
      turn++;
      if (turn === 1) {
        const text = "Je suis l’assistant de démarches administratives.";
        await options.onTextDelta(text);
        return { text, calls: [] };
      }
      return { text: "", calls: [] };
    },
  };
  const agent = new Agent(pool, conversations, model, tooling);
  const first = await conversations.create(user, { locale: "fr" }, identifier("key"));
  await conversations.accept(user, first.id, { id: identifier("msg"), content: { type: "text", text: "comment fonctionne l'assistant ?" }, sentAt: new Date().toISOString() }, identifier("key"), tp);
  await agent.process(first.id);
  const firstReceived = (await conversations.page(user.userRef, first.id)).items[0];
  const firstLive = await conversations.page(user.userRef, first.id, firstReceived.id);
  const firstKinds = firstLive.items.map((event) => event.data.kind);
  assert.ok(firstKinds.includes("message.delta"));
  assert.ok(firstKinds.indexOf("message.delta") < firstKinds.indexOf("message.sent"));

  const second = await conversations.create(user, { locale: "fr" }, identifier("key"));
  await conversations.accept(user, second.id, { id: identifier("msg"), content: { type: "text", text: "…" }, sentAt: new Date().toISOString() }, identifier("key"), tp);
  await agent.process(second.id);
  const secondReceived = (await conversations.page(user.userRef, second.id)).items[0];
  const secondLive = await conversations.page(user.userRef, second.id, secondReceived.id);
  const secondKinds = secondLive.items.map((event) => event.data.kind);
  assert.ok(secondKinds.includes("message.delta"));
  assert.ok(secondKinds.indexOf("message.delta") < secondKinds.indexOf("message.sent"));
});
