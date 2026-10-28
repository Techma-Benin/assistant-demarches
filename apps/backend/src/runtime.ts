import { readFile } from "node:fs/promises";
import { importPKCS8 } from "jose";
import type { Pool } from "pg";
import type { AuthOptions } from "./auth.js";
import { Identities } from "./identity.js";
import { Conversations } from "./conversations.js";
import { Files } from "./files.js";
import { storageFromEnvironment } from "./storage.js";
import { Consent } from "./consent.js";
import { HttpMandateControl, McpGateway } from "./tooling.js";
import { HttpModels, type Provider } from "./model.js";
import { Agent } from "./agent.js";
import { Problem, approvedMcpUrl } from "./domain.js";
import type { Runtime } from "./routes.js";

export const required = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error("Missing environment variable: " + name);
  return value;
};
export class ServiceTokens {
  private cache = new Map<string, { token: string; expires: number }>();
  async get(
    client: "backend-agent" | "backend-mandates" | "backend-delivery",
    scope: string,
    audience: string,
  ) {
    const prefix =
      client === "backend-agent"
        ? "TOOLING_AGENT"
        : client === "backend-mandates"
          ? "TOOLING_CONTROL"
          : "WHATSAPP_DELIVERY";
    const direct = process.env[prefix + "_TOKEN"];
    if (direct) return direct;
    const existing = this.cache.get(client);
    if (existing && existing.expires > Date.now() + 30000)
      return existing.token;
    const endpoint = required("SERVICE_TOKEN_URL");
    if (!approvedMcpUrl(endpoint, new Set([new URL(endpoint).href])))
      throw new Error("Token endpoint requires HTTPS outside localhost.");
    const result = await fetch(endpoint, {
      method: "POST",
      redirect: "error",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: client,
        client_secret: required(prefix + "_CLIENT_SECRET"),
        scope,
        audience,
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
    this.cache.set(client, {
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
) {
  const identities = new Identities(
    pool,
    required("IDENTITY_HMAC_KEY"),
    required("DEFAULT_ADMINISTRATION_ID"),
  );
  const conversations = new Conversations(pool);
  const files = new Files(
    pool,
    storageFromEnvironment(),
  );
  const tokens = new ServiceTokens();
  const runtime: Runtime = {
    pool,
    auth,
    identities,
    conversations,
    files,
    publicUrl: process.env.PUBLIC_BACKEND_URL,
  };
  if (process.env.MANDATE_SIGNING_KEY_FILE) {
    const control = new HttpMandateControl(
      required("TOOLING_CONTROL_URL"),
      () => tokens.get("backend-mandates", "mandates:grant", "techma-tooling"),
    );
    const key = await importPKCS8(
      await readFile(process.env.MANDATE_SIGNING_KEY_FILE, "utf8"),
      "RS256",
    );
    runtime.consent = new Consent(pool, conversations, control, {
      key,
      kid: required("MANDATE_SIGNING_KEY_ID"),
      issuer: required("MANDATE_ISSUER"),
    });
  }
  const references = JSON.parse(
    process.env.MCP_SECRET_REFERENCES ?? "{}",
  ) as Record<string, string>;
  const tooling = new McpGateway(allowedMcpUrls, async (reference) =>
    reference === "backend-agent"
      ? tokens.get("backend-agent", "tools:call", "techma-tooling")
      : required(references[reference] ?? "MISSING_MCP_SECRET_REFERENCE"),
  );
  runtime.tooling = tooling;
  const models = new HttpModels(
    JSON.parse(process.env.MODEL_PROVIDERS_JSON ?? "{}") as Record<
      string,
      Provider
    >,
  );
  const agent = new Agent(
    pool,
    conversations,
    models,
    tooling,
    runtime.consent,
  );
  return { runtime, agent, tokens };
}
