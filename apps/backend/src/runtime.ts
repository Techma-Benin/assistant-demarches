import type { Pool } from "pg";
import type { AuthOptions } from "./auth.js";
import { Identities } from "./identity.js";
import { Conversations } from "./conversations.js";
import { Files } from "./files.js";
import { storageFromEnvironment } from "./storage.js";
import { Consent, McpProcedureCatalog } from "./consent.js";
import { catalog, HttpMandateControl, McpGateway } from "./tooling.js";
import { HttpModels } from "./model.js";
import { syncEnvModel } from "./model-env.js";
import { Agent } from "./agent.js";
import { Problem, approvedMcpUrl } from "./domain.js";
import type { Runtime } from "./routes.js";
import { XroadClient } from "./xroad.js";
import { transcriberFromEnvironment } from "./transcription.js";

export const required = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error("Missing environment variable: " + name);
  return value;
};
export class ServiceTokens {
  private cache = new Map<string, { token: string; expires: number }>();
  async get(scope: string) {
    const existing = this.cache.get(scope);
    if (existing && existing.expires > Date.now() + 30000)
      return existing.token;
    const endpoint = new URL(
      "protocol/openid-connect/token",
      required("OIDC_ISSUER").endsWith("/")
        ? required("OIDC_ISSUER")
        : required("OIDC_ISSUER") + "/",
    ).href;
    if (!approvedMcpUrl(endpoint, new Set([endpoint])))
      throw new Error("Token endpoint requires HTTPS outside localhost.");
    const result = await fetch(endpoint, {
      method: "POST",
      redirect: "error",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: required("OIDC_CLIENT_ID"),
        client_secret: required("OIDC_CLIENT_SECRET"),
        ...(scope && scope !== "keycloak-admin" ? { scope } : {}),
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!result.ok)
      throw new Problem(
        503,
        "UPSTREAM_UNAVAILABLE",
        "Identité de service indisponible.",
      );
    const value = (await result.json()) as {
      access_token?: string;
      expires_in?: number;
    };
    if (!value.access_token || typeof value.expires_in !== "number")
      throw new Problem(
        503,
        "UPSTREAM_UNAVAILABLE",
        "Réponse identité invalide.",
      );
    this.cache.set(scope, {
      token: value.access_token,
      expires: Date.now() + value.expires_in * 1000,
    });
    return value.access_token;
  }
}
export async function loadRuntime(
  pool: Pool,
  auth: AuthOptions,
  allowedMcpUrls: ReadonlySet<string>,
  signingKey: CryptoKey,
  npiSubjectKey?: Uint8Array,
) {
  await pool.query("SELECT 1");
  const identities = new Identities(pool);
  const conversations = new Conversations(pool);
  const files = new Files(
    pool,
    storageFromEnvironment(),
  );
  const tokens = new ServiceTokens();
  const references = JSON.parse(
    process.env.MCP_SECRET_REFERENCES ?? "{}",
  ) as Record<string, string>;
  const tooling = new McpGateway(allowedMcpUrls, async (reference) =>
    reference === "backend"
      ? tokens.get("tools:call")
      : required(references[reference] ?? "MISSING_MCP_SECRET_REFERENCE"),
  );
  const mcpUrl = process.env.TOOLING_MCP_URL ?? [...allowedMcpUrls][0];
  await syncTechmaMcp(pool, mcpUrl);
  const signing = {
    key: signingKey,
    kid: "backend-signing",
    issuer: required("PUBLIC_URL"),
  };
  const transcriber = transcriberFromEnvironment(files);
  const runtime: Runtime = {
    pool,
    auth,
    identities,
    conversations,
    files,
    ...(transcriber ? { transcriber } : {}),
    publicUrl: process.env.PUBLIC_URL,
    signing,
    xroadUrl: process.env.XROAD_URL,
    serviceTokens: tokens,
    ...(npiSubjectKey ? { npiSubjectKey } : {}),
  };
  const control = new HttpMandateControl(required("TOOLING_URL"), () =>
    tokens.get("mandates:grant"),
  );
  runtime.consent = new Consent(
    pool,
    conversations,
    control,
    signing,
    new McpProcedureCatalog(pool, tooling),
  );
  runtime.tooling = tooling;
  await syncEnvModel(pool);
  const models = new HttpModels({});
  const agent = new Agent(
    pool,
    conversations,
    models,
    tooling,
    runtime.consent,
    transcriber,
    process.env.XROAD_URL
      ? (userRef) =>
          new XroadClient(process.env.XROAD_URL!, () => tokens.get("xroad:apply")).cases(userRef, "?limit=20")
      : undefined,
  );
  return { runtime, agent, tokens };
}
/** Registers the published Techma Tooling connection when the URL is known. Operator flags are kept. */
export async function syncTechmaMcp(pool: Pool, mcpUrl?: string) {
  if (!mcpUrl) return;
  const url = new URL(mcpUrl).href;
  if (!approvedMcpUrl(url, new Set([url])))
    throw new Error("TOOLING_MCP_URL requires HTTPS outside localhost.");
  const server = {
    id: "tooling",
    name: "Tooling Techma",
    url,
    enabled: true,
    transport: "streamable-http",
    auth: { type: "bearer" as const, secretRef: "backend" },
    policy: "techma" as const,
  };
  await pool.query(
    `INSERT INTO backend_mcp_servers(administration_id,id,body) VALUES('global','tooling',$1)
     ON CONFLICT(administration_id,id) DO UPDATE SET
       body=jsonb_set(excluded.body, '{enabled}', COALESCE(backend_mcp_servers.body->'enabled', 'true'::jsonb)),
       revision=backend_mcp_servers.revision+1
     WHERE backend_mcp_servers.body->>'policy'='techma'`,
    [server],
  );
  for (const tool of catalog) {
    await pool.query(
      `INSERT INTO backend_mcp_tools(administration_id,server_id,name,definition,available,enabled,requires_mandate)
       VALUES('global','tooling',$1,$2,true,true,$3)
       ON CONFLICT(administration_id,server_id,name) DO UPDATE SET
         definition=COALESCE(backend_mcp_tools.definition, excluded.definition),
         available=true`,
      [tool.name, tool, Boolean(tool._meta?.["bj.techma/requiresMandate"])],
    );
  }
}
