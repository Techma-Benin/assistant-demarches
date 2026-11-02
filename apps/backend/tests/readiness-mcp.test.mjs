import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { probeReadiness } from "../dist/apps/backend/src/readiness.js";
import { catalog } from "../dist/apps/backend/src/tooling.js";

const pool = { async query() { return { rows: [] }; } };
const listed = (tools, extra = {}) => ({ jsonrpc: "2.0", id: 1, result: { tools, ...extra } });
const asTool = (tool) => ({ name: tool.name, inputSchema: tool.inputSchema });

async function probe(t, answer) {
  const server = http.createServer(async (req, res) => {
    for await (const _chunk of req);
    answer(res);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  const url = `http://127.0.0.1:${server.address().port}/mcp`;
  return (await probeReadiness({ pool, mcpUrl: url })).mcpTools;
}
const json = (body) => (res) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(body)); };

test("mcpTools.ok needs a valid tools/list, not just an HTTP 200", async (t) => {
  assert.equal((await probe(t, json({ jsonrpc: "2.0", id: 1, result: {} }))).ok, false, "200 without result.tools");
  assert.equal((await probe(t, json({ ok: true }))).ok, false, "200 with an unrelated body");
  assert.equal((await probe(t, json({ jsonrpc: "2.0", id: 1, error: { code: -32601, message: "x" } }))).ok, false, "JSON-RPC error");
  assert.equal((await probe(t, json(listed([])))).ok, false, "empty list");
  assert.equal((await probe(t, json(listed([{ name: 3 }])))).ok, false, "malformed tool");
  assert.equal((await probe(t, json(listed([{ name: "x" }])))).ok, false, "tool without inputSchema");
  const partial = await probe(t, json(listed(catalog.slice(1).map(asTool))));
  assert.equal(partial.ok, false, "a complete answer that lacks catalogue tools");
  assert.match(partial.detail, /incomplet/);
  assert.equal((await probe(t, json(listed([asTool({ name: "foreign.tool", inputSchema: { type: "object" } })], { nextCursor: "p2" })))).ok, false, "page without any catalogue tool");

  const full = await probe(t, json(listed(catalog.map(asTool))));
  assert.equal(full.ok, true);
  assert.equal(full.detail, `${catalog.length} outils MCP`);
  assert.equal((await probe(t, json(listed(catalog.slice(0, 2).map(asTool), { nextCursor: "p2" })))).ok, true, "first page of a paginated list");
  const sse = await probe(t, (res) => { res.setHeader("content-type", "text/event-stream"); res.end("event: message\ndata: " + JSON.stringify(listed(catalog.map(asTool))) + "\n\n"); });
  assert.equal(sse.ok, true, "SSE-framed answer");
});
