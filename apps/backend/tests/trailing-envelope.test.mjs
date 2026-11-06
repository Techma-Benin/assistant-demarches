import { test } from "node:test";
import assert from "node:assert/strict";
import { presentModelReply } from "../dist/apps/backend/src/model-reply.js";
import { LiveReply } from "../dist/apps/backend/src/live-reply.js";

const source = { procedureId: "PS00392", url: "https://service-public.bj/public/services/service/PS00392", retrievedAt: "2026-10-30T10:00:00Z" };
const evidence = { sources: [source], requests: [] };
const envelope = JSON.stringify({ blocks: [{ type: "text", text: "Voici la réponse.", sources: [{ procedureId: source.procedureId, url: source.url }] }] });
const texts = (blocks) => blocks.filter((block) => block.type === "text").map((block) => block.text);

test("prose followed by an envelope: the envelope wins, with its bound source", () => {
  const blocks = presentModelReply(`Je vérifie cela pour vous.\n${envelope}`, evidence);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].text, "Voici la réponse.");
  assert.deepEqual(blocks[0].sources, [source]);
  assert.equal(texts(blocks).some((text) => text.includes('"blocks"')), false);
});

test("prose followed by a fenced envelope: fences are consumed", () => {
  const blocks = presentModelReply(`Je vérifie cela pour vous.\n\n\`\`\`json\n${envelope}\n\`\`\``, evidence);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].text, "Voici la réponse.");
  assert.deepEqual(blocks[0].sources, [source]);
  assert.equal(texts(blocks).some((text) => text.includes('"blocks"') || text.includes("```")), false);
});

test("prose followed by a truncated envelope keeps the prose only", () => {
  const blocks = presentModelReply(`Je vérifie cela pour vous.\n${envelope.slice(0, 40)}`, { sources: [], requests: [] });
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].text, "Je vérifie cela pour vous.");
  assert.deepEqual(blocks[0].sources, []);
});

test("prose without envelope is still one block with the whole text", () => {
  const blocks = presentModelReply("Bonjour, je peux vous aider.", { sources: [], requests: [] });
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].text, "Bonjour, je peux vous aider.");
});

test("LiveReply: prose + envelope stages nothing, publishVisible speaks", async () => {
  const published = [];
  const conversations = { pool: { async query() { return { rows: [] }; } }, async appendDelta(_c, _m, delta) { published.push(delta); return 1; } };
  const live = new LiveReply(conversations, "cnv", "msg", "00-" + "3".repeat(32) + "-" + "4".repeat(16) + "-01", 0);
  const listener = await live.attempt([source]);
  const reply = `Je vérifie.\n${envelope}`;
  listener.onTextDelta(reply);
  listener.complete(reply);
  await live.settle();
  assert.deepEqual(published, []);
  live.publishVisible("texte");
  await live.close();
  assert.equal(published.join(""), "texte");
  assert.equal(published.some((delta) => delta.includes('"blocks"')), false);
});
