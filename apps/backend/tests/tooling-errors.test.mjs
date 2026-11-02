import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { catalog, McpGateway } from "../dist/apps/backend/src/tooling.js";

const tp = "00-" + "1".repeat(32) + "-" + "2".repeat(16) + "-01";
const context = { conversationId: "cnv_1", userRef: "usr_1", traceparent: tp };
const tool = catalog.find((item) => item.outputSchema && !item._meta?.["bj.techma/requiresMandate"]);

async function mcpServer(handler) {
  const upstream = http.createServer(async (req, res) => {
    const server = new Server({ name: "fake", version: "1" }, { capabilities: { tools: {} } });
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [tool] }));
    server.setRequestHandler(CallToolRequestSchema, handler);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => { transport.close(); server.close(); });
    await server.connect(transport);
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    await transport.handleRequest(req, res, chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined);
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  return { upstream, url: "http://127.0.0.1:" + upstream.address().port + "/mcp" };
}

test("McpGateway keeps its own Problem for a non-conformant tool output and only maps transport failures to MCP_CONNECTION_FAILED", async (t) => {
  assert.ok(tool, "the catalog has a tool with an output schema");
  const { upstream, url } = await mcpServer(async () => ({ structuredContent: { unexpected: true }, content: [{ type: "text", text: "{}" }] }));
  t.after(() => new Promise((resolve) => { upstream.closeAllConnections(); upstream.close(resolve); }));
  const gateway = new McpGateway(new Set([url]), async () => "token");
  const args = Object.fromEntries((tool.inputSchema.required ?? []).map((name) => [name, tool.inputSchema.properties[name]?.type === "integer" ? 1 : "ab"]));
  await assert.rejects(
    () => gateway.call(url, "backend-agent", tool.name, args, context, "key-1", tool),
    (error) => error.status === 503 && error.code === "UPSTREAM_UNAVAILABLE" && /non conforme/.test(error.message),
  );

  const dead = http.createServer();
  dead.listen(0, "127.0.0.1");
  await once(dead, "listening");
  const deadUrl = "http://127.0.0.1:" + dead.address().port + "/mcp";
  await new Promise((resolve) => dead.close(resolve));
  const lost = new McpGateway(new Set([deadUrl]), async () => "token");
  await assert.rejects(
    () => lost.discover(deadUrl, "backend-agent", context),
    (error) => error.status === 503 && error.code === "MCP_CONNECTION_FAILED",
  );
});
