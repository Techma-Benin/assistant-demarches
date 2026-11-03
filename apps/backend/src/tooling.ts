import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { approvedMcpUrl, canonical, Problem } from "./domain.js";
const domain = JSON.parse(readFileSync(new URL("./assets/domain.schema.json", import.meta.url), "utf8")) as { $id: string };
const catalogue = JSON.parse(readFileSync(new URL("./assets/mcp.tools.json", import.meta.url), "utf8")) as {
  tools: ToolDefinition[];
  $defs?: Record<string, unknown>;
};
const catalogDefs = catalogue.$defs ?? {};
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
/** Merge catalogue-root $defs with any schema-local $defs (Tooling may inline a subset). */
export function mcpSchemaDefs(schema: Record<string, unknown>): Record<string, unknown> {
  return { ...catalogDefs, ...(isRecord(schema.$defs) ? schema.$defs : {}) };
}
/** Attach $defs so Ajv can compile a raw catalogue fragment (`#/$defs/ProcedureId`) or a self-contained Tooling schema. */
export function withMcpDefs(schema: Record<string, unknown>): Record<string, unknown> {
  return { ...schema, $defs: mcpSchemaDefs(schema) };
}
/** Inline `#/$defs/…` from the catalogue root (and local $defs) so two writings of the same tool compare equal. */
export function resolveMcpSchema(schema: Record<string, unknown>, defs = mcpSchemaDefs(schema)): Record<string, unknown> {
  const seen = new Set<string>();
  const resolve = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(resolve);
    if (!isRecord(value)) return value;
    if (typeof value.$ref === "string" && value.$ref.startsWith("#/$defs/")) {
      const name = value.$ref.slice("#/$defs/".length);
      const def = defs[name];
      if (!isRecord(def) || seen.has(name)) return value;
      seen.add(name);
      const resolved = resolve(def);
      seen.delete(name);
      return resolved;
    }
    const next: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      if (key === "$defs") continue;
      next[key] = resolve(nested);
    }
    return next;
  };
  return resolve(schema) as Record<string, unknown>;
}
// Each remote schema has its own registry: two servers may legitimately reuse $id.
export function compileMcpSchema(schema: Record<string, unknown>) {
  const validator = new Ajv2020({ strict: false, allErrors: true });
  (addFormats as unknown as (instance: Ajv2020) => void)(validator);
  validator.addSchema(domain);
  return validator.compile(withMcpDefs(schema));
}
export function sameMcpDefinition(left: unknown, right: unknown): boolean {
  return canonical(normalizeMcpDefinition(left)) === canonical(normalizeMcpDefinition(right));
}
function normalizeMcpDefinition(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const input = isRecord(value.inputSchema) ? resolveMcpSchema(value.inputSchema) : value.inputSchema;
  const output = isRecord(value.outputSchema) ? resolveMcpSchema(value.outputSchema) : value.outputSchema;
  return { name: value.name, inputSchema: input, outputSchema: output, _meta: value._meta };
}
export type McpAuth = {
  type: "none";
} | {
  type: "bearer";
  secretRef: string;
} | {
  type: "headers";
  headers: Record<string, string>;
} | {
  type: "oauth-client-credentials";
  tokenUrl: string;
  clientId: string;
  clientSecretRef: string;
  scope?: string;
  audience?: string;
};
export type ToolContext = {
  conversationId: string;
  userRef: string;
  traceparent: string;
  mandateId?: string;
  channel?: "web" | "whatsapp";
  authenticated?: boolean;
  external?: boolean;
};
export type ToolDefinition = {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  _meta?: Record<string, unknown>;
};
export const catalog = catalogue.tools;
export type ToolResult = {
  isError?: boolean;
  structuredContent?: unknown;
  content: {
    type: string;
    text?: string;
  }[];
};
/** Tooling v2 puts the JSON body in `structuredContent` and duplicates it as a text block. */
export function structuredFrom(result: ToolResult): unknown {
  if (result.structuredContent !== undefined) return result.structuredContent;
  const text = result.content.find((item) => item.type === "text")?.text;
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
export function catalogTool(name: string): ToolDefinition | undefined {
  return catalog.find((tool) => tool.name === name);
}
export type ToolingPort = {
  discover(url: string, secretRef: string | McpAuth, context: ToolContext): Promise<ToolDefinition[]>;
  call(url: string, secretRef: string | McpAuth, name: string, args: Record<string, unknown>, context: ToolContext, key: string, definition?: ToolDefinition): Promise<ToolResult>;
};
export class McpGateway implements ToolingPort {
  constructor(private allowed: ReadonlySet<string>, private token: (reference: string) => Promise<string>) { }
  private async using<T>(url: string, secretRef: string | McpAuth, context: ToolContext, key: string | undefined, work: (client: Client) => Promise<T>): Promise<T> {
    if (!approvedMcpUrl(url, this.allowed))
      throw new Problem(403, "FORBIDDEN", "Serveur MCP non autorisé.");
    const auth = typeof secretRef === "string" ? { type: "bearer" as const, secretRef } : secretRef;
    const headers: Record<string, string> = {};
    try {
      if (auth.type === "bearer")
        headers.Authorization = "Bearer " + await this.token(auth.secretRef);
      if (auth.type === "headers") {
        for (const [name, reference] of Object.entries(auth.headers))
          headers[name] = await this.token(reference);
      }
      if (auth.type === "oauth-client-credentials") {
        if (!approvedMcpUrl(auth.tokenUrl, this.allowed))
          throw new Problem(403, "FORBIDDEN", "Serveur OAuth non autorisé.");
        const response = await fetch(auth.tokenUrl, {
          method: "POST", redirect: "error", signal: AbortSignal.timeout(15000),
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ grant_type: "client_credentials", resource: new URL(url).href, client_id: auth.clientId, client_secret: await this.token(auth.clientSecretRef), ...(auth.scope ? { scope: auth.scope } : {}), ...(auth.audience ? { audience: auth.audience } : {}) }),
        });
        if (!response.ok)
          throw new Problem(503, "MCP_AUTH_FAILED", "Authentification du serveur MCP refusée.");
        const value = await response.json() as {
          access_token?: string;
          token_type?: string;
        };
        if (!value.access_token || value.token_type?.toLowerCase() !== "bearer")
          throw new Problem(503, "MCP_AUTH_FAILED", "Réponse OAuth invalide.");
        headers.Authorization = "Bearer " + value.access_token;
      }
    }
    catch {
      throw new Problem(503, "MCP_AUTH_FAILED", "Authentification MCP indisponible ; vérifier les références de secrets et le fournisseur.");
    }
    const client = new Client({ name: "techma-backend", version: "0.1.0" });
    const transport = new StreamableHTTPClientTransport(new URL(url), {
      requestInit: {
        redirect: "error",
        headers: {
          ...headers,
          traceparent: context.traceparent,
          ...(!context.external && context.conversationId && context.userRef ? {
            "X-Conversation-Id": context.conversationId,
            "X-User-Ref": context.userRef,
            ...(context.channel ? { "X-Channel": context.channel } : {}),
            "X-Authenticated": context.authenticated ? "true" : "false",
            ...(context.mandateId ? { "X-Mandate-Id": context.mandateId } : {}),
          } : {}),
          ...(key ? { "Idempotency-Key": key } : {}),
        },
      },
      fetch: (input, init) => fetch(input, {
        ...init,
        redirect: "error",
        signal: AbortSignal.timeout(30000),
      }),
    });
    try {
      await client.connect(transport);
      return await work(client);
    }
    catch (error) {
      // Business and validation Problems raised by work() (e.g. non-conformant tool output) keep their own code.
      if (error instanceof Problem) throw error;
      console.error(error instanceof Error ? error.message : error);
      throw new Problem(503, "MCP_CONNECTION_FAILED", "Connexion ou réponse MCP indisponible ; vérifier les paramètres et l’authentification.");
    }
    finally {
      await client.close();
    }
  }
  async discover(url: string, secretRef: string | McpAuth, context: ToolContext) {
    return this.using(url, secretRef, context, undefined, async (client) => {
      const tools: ToolDefinition[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < 20; page++) {
        const response = await client.listTools(cursor ? { cursor } : {});
        tools.push(...(response.tools as ToolDefinition[]));
        cursor = response.nextCursor;
        if (!cursor)
          return tools;
      }
      throw new Problem(503, "UPSTREAM_UNAVAILABLE", "Catalogue MCP trop volumineux.");
    });
  }
  async call(url: string, secretRef: string | McpAuth, name: string, args: Record<string, unknown>, context: ToolContext, key: string, definition?: ToolDefinition) {
    const expected = definition ?? catalog.find(t => t.name === name);
    if (expected && !compileMcpSchema(expected.inputSchema)(args))
      throw new Problem(400, "INVALID_REQUEST", "Arguments outil invalides.");
    return this.using(url, secretRef, context, key, async (client) => {
      const result = (await client.callTool({ name, arguments: args }, undefined, { timeout: 30000 })) as ToolResult;
      if (result.structuredContent === undefined)
        result.structuredContent = structuredFrom(result);
      if (!result.isError && expected?.outputSchema && !compileMcpSchema(expected.outputSchema)(result.structuredContent))
        throw new Problem(503, "UPSTREAM_UNAVAILABLE", "Sortie outil non conforme.");
      return result;
    });
  }
}
export type MandateControl = {
  grant(body: unknown, key: string, traceparent: string): Promise<unknown>;
  revoke(id: string, key: string, traceparent: string, userRef: string): Promise<unknown>;
};
export class HttpMandateControl implements MandateControl {
  constructor(private baseUrl: string, private token: () => Promise<string>) {
    if (!approvedMcpUrl(baseUrl, new Set([new URL(baseUrl).href])))
      throw new Error("Tooling control URL requires HTTPS outside localhost.");
  }
  private async post(path: string, body: unknown, key: string, traceparent: string, extra: Record<string, string> = {}) {
    const res = await fetch(new URL(path, this.baseUrl), {
      method: "POST",
      redirect: "error",
      headers: {
        Authorization: "Bearer " + (await this.token()),
        traceparent,
        "Idempotency-Key": key,
        "Content-Type": "application/json",
        ...extra,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
    const value = (await res.json()) as Record<string, unknown>;
    if (!res.ok)
      throw new Problem([400, 403, 404, 409].includes(res.status) ? res.status : 503, typeof value.code === "string" ? value.code : "UPSTREAM_UNAVAILABLE", "Le contrôle du mandat a refusé ou interrompu la demande.");
    return value;
  }
  grant(body: unknown, key: string, traceparent: string) {
    return this.post("/internal/v1/mandates", body, key, traceparent);
  }
  revoke(id: string, key: string, traceparent: string, userRef: string) {
    return this.post("/internal/v1/mandates/" + encodeURIComponent(id) + "/revoke", {}, key, traceparent, {
      "X-User-Ref": userRef,
    });
  }
}
