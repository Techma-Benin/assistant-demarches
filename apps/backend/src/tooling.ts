import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ajv, approvedMcpUrl, Problem } from "./domain.js";

export type ToolContext = {
  conversationId: string;
  userRef: string;
  traceparent: string;
  mandateId?: string;
};
export type ToolDefinition = {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  _meta?: Record<string, unknown>;
};
export const catalog = JSON.parse(
  readFileSync(new URL("./assets/mcp.tools.json", import.meta.url), "utf8"),
).tools as ToolDefinition[];
export type ToolResult = {
  isError?: boolean;
  structuredContent?: unknown;
  content: { type: string; text?: string }[];
};
export type ToolingPort = {
  discover(
    url: string,
    secretRef: string,
    context: ToolContext,
  ): Promise<ToolDefinition[]>;
  call(
    url: string,
    secretRef: string,
    name: string,
    args: Record<string, unknown>,
    context: ToolContext,
    key: string,
  ): Promise<ToolResult>;
};
export class McpGateway implements ToolingPort {
  constructor(
    private allowed: ReadonlySet<string>,
    private token: (reference: string) => Promise<string>,
  ) {}
  private async using<T>(
    url: string,
    secretRef: string,
    context: ToolContext,
    key: string | undefined,
    work: (client: Client) => Promise<T>,
  ): Promise<T> {
    if (!approvedMcpUrl(url, this.allowed))
      throw new Problem(403, "FORBIDDEN", "Serveur MCP non autorisé.");
    const client = new Client({ name: "techma-backend", version: "0.1.0" });
    const transport = new StreamableHTTPClientTransport(new URL(url), {
      requestInit: {
        redirect: "error",
        headers: {
          Authorization: "Bearer " + (await this.token(secretRef)),
          traceparent: context.traceparent,
          "X-Conversation-Id": context.conversationId,
          "X-User-Ref": context.userRef,
          ...(context.mandateId ? { "X-Mandate-Id": context.mandateId } : {}),
          ...(key ? { "Idempotency-Key": key } : {}),
        },
      },
      fetch: (input, init) =>
        fetch(input, {
          ...init,
          redirect: "error",
          signal: AbortSignal.timeout(30000),
        }),
    });
    try {
      await client.connect(transport);
      return await work(client);
    } finally {
      await client.close();
    }
  }
  async discover(url: string, secretRef: string, context: ToolContext) {
    return this.using(url, secretRef, context, undefined, async (client) => {
      const tools: ToolDefinition[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < 20; page++) {
        const response = await client.listTools(cursor ? { cursor } : {});
        tools.push(...(response.tools as ToolDefinition[]));
        cursor = response.nextCursor;
        if (!cursor) return tools;
      }
      throw new Problem(
        503,
        "UPSTREAM_UNAVAILABLE",
        "Catalogue MCP trop volumineux.",
      );
    });
  }
  async call(
    url: string,
    secretRef: string,
    name: string,
    args: Record<string, unknown>,
    context: ToolContext,
    key: string,
  ) {
    const expected = catalog.find((tool) => tool.name === name);
    if (!expected || !ajv.compile(expected.inputSchema)(args))
      throw new Problem(400, "INVALID_REQUEST", "Arguments outil invalides.");
    return this.using(url, secretRef, context, key, async (client) => {
      const result = (await client.callTool(
        { name, arguments: args },
        undefined,
        { timeout: 30000 },
      )) as ToolResult;
      if (
        !result.isError &&
        expected.outputSchema &&
        !ajv.compile(expected.outputSchema)(result.structuredContent)
      )
        throw new Problem(
          503,
          "UPSTREAM_UNAVAILABLE",
          "Sortie outil non conforme.",
        );
      return result;
    });
  }
}
export type MandateControl = {
  grant(body: unknown, key: string, traceparent: string): Promise<unknown>;
  revoke(id: string, key: string, traceparent: string): Promise<unknown>;
};
export class HttpMandateControl implements MandateControl {
  constructor(
    private baseUrl: string,
    private token: () => Promise<string>,
  ) {
    if (!approvedMcpUrl(baseUrl, new Set([new URL(baseUrl).href])))
      throw new Error("Tooling control URL requires HTTPS outside localhost.");
  }
  private async post(
    path: string,
    body: unknown,
    key: string,
    traceparent: string,
  ) {
    const res = await fetch(new URL(path, this.baseUrl), {
      method: "POST",
      redirect: "error",
      headers: {
        Authorization: "Bearer " + (await this.token()),
        traceparent,
        "Idempotency-Key": key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
    const value = (await res.json()) as Record<string, unknown>;
    if (!res.ok)
      throw new Problem(
        [400, 403, 404, 409].includes(res.status) ? res.status : 503,
        typeof value.code === "string" ? value.code : "UPSTREAM_UNAVAILABLE",
        "Le contrôle du mandat a refusé ou interrompu la demande.",
      );
    return value;
  }
  grant(body: unknown, key: string, traceparent: string) {
    return this.post("/internal/v1/mandates", body, key, traceparent);
  }
  revoke(id: string, key: string, traceparent: string) {
    return this.post(
      "/internal/v1/mandates/" + encodeURIComponent(id) + "/revoke",
      {},
      key,
      traceparent,
    );
  }
}
