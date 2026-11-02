import { test } from "node:test";
import assert from "node:assert/strict";
import { LiveReply } from "../dist/apps/backend/src/live-reply.js";

const tp = "00-" + "1".repeat(32) + "-" + "2".repeat(16) + "-01";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const quiet = (t) => { const original = console.error; console.error = () => {}; t.after(() => { console.error = original; }); };
const OPEN = '{"blocks":[{"type":"text","text":"';

function database({ failures = new Set() } = {}) {
  const written = [];
  let call = 0;
  return {
    written,
    calls: () => call,
    pool: { async query() { return { rows: [] }; } },
    async appendDelta(_conversationId, _messageId, delta, index) {
      call += 1;
      if (failures.has(call)) throw new Error("database down");
      const parts = Math.ceil(delta.length / 8000);
      written.push({ delta, index });
      return parts;
    },
  };
}

test("a failed delta write keeps the buffered text and retries it without duplicating or skipping an index", async (t) => {
  quiet(t);
  const fake = database({ failures: new Set([1, 2]) });
  const live = new LiveReply(fake, "cnv", "msg", tp, 5);
  const listener = await live.attempt();
  listener.onTextDelta(OPEN + "Bonjour ");
  await sleep(30); // flush #1 fails
  listener.onTextDelta("et bienvenue ");
  await sleep(30); // flush #2 fails again
  listener.onTextDelta("au portail.");
  await live.settle(); // the base is back: everything goes out, in order
  assert.equal(fake.written.map((item) => item.delta).join(""), "Bonjour et bienvenue au portail.");
  assert.deepEqual(fake.written.map((item) => item.index), fake.written.map((_, index) => index), "indexes 0-based, contiguous");
  assert.ok(fake.written.length >= 1);
  await live.close();
});

test("a persistent database failure never fails the reply and nothing is lost for the final message", async (t) => {
  quiet(t);
  const fake = database({ failures: new Set(Array.from({ length: 50 }, (_, index) => index + 1)) });
  const live = new LiveReply(fake, "cnv", "msg", tp, 5);
  const listener = await live.attempt();
  listener.onTextDelta(OPEN + "Texte");
  await sleep(20);
  await live.settle(); // resolves, does not throw
  await live.close();
  assert.deepEqual(fake.written, []);
});

test("large buffers are written one stored part at a time, so a failure never leaves a half-written delta", async (t) => {
  quiet(t);
  const fake = database({ failures: new Set([2]) });
  const live = new LiveReply(fake, "cnv", "msg", tp, 5);
  const listener = await live.attempt();
  const text = "a".repeat(8000) + "b".repeat(8000) + "c".repeat(100);
  listener.onTextDelta(OPEN + text);
  await live.settle(); // part 1 ok, part 2 fails, settle ends
  await live.settle(); // retried: parts 2 and 3
  assert.equal(fake.written.map((item) => item.delta).join(""), text);
  assert.deepEqual(fake.written.map((item) => item.index), [0, 1, 2]);
  await live.close();
});

test("a database error while checking for an earlier draft does not fail the generation", async (t) => {
  quiet(t);
  const fake = database();
  let down = true;
  fake.pool = { async query() { if (down) throw new Error("database down"); return { rows: [] }; } };
  const live = new LiveReply(fake, "cnv", "msg", tp, 5);
  const silent = await live.attempt(); // resolves
  silent.onTextDelta(OPEN + "Brouillon");
  await live.settle();
  assert.deepEqual(fake.written, [], "no draft is streamed when it is unknown whether one already exists");
  down = false;
  const listener = await live.attempt();
  listener.onTextDelta(OPEN + "Suite");
  await live.settle();
  assert.equal(fake.written.map((item) => item.delta).join(""), "Suite");
  await live.close();
});
