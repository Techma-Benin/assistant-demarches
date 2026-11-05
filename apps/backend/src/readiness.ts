import type { Pool } from "pg";
import { providerReason } from "./diagnostics.js";
import { catalog } from "./tooling.js";

/** Model probe budget: a loaded machine needs more than 1.5 s. */
const MODEL_PROBE_TIMEOUT_MS = 5000;

export type ComponentStatus = { ok: boolean; detail: string };
export type ReadyReport = {
  status: "ok" | "degraded";
  model: ComponentStatus;
  tooling: ComponentStatus;
  mcpTools: ComponentStatus;
  xroad: ComponentStatus;
  oidc: ComponentStatus;
  database: ComponentStatus;
};

export type ReadinessOptions = {
  pool: Pool;
  toolingUrl?: string;
  mcpUrl?: string;
  /** Service token for the MCP endpoint: Tooling v2 refuses `tools/list` without one. */
  mcpToken?: () => Promise<string>;
  xroadUrl?: string;
  oidcJwksUrl?: string;
  /** `process.env` by default; override in tests. */
  environment?: NodeJS.ProcessEnv;
};

const PROBE_TTL_MS = 60_000;
let probeCache: { key: string; at: number; result: ComponentStatus } | undefined;

export function resetReadinessProbeCache(): void {
  probeCache = undefined;
}

export function modelReadinessProbeEnabled(environment: NodeJS.ProcessEnv = process.env): boolean {
  const flag = (environment.MODEL_READINESS_PROBE ?? "").toLowerCase();
  if (flag === "off" || flag === "0" || flag === "false") return false;
  if (flag === "on" || flag === "1" || flag === "true") return true;
  return !environment.NODE_TEST_CONTEXT;
}

async function probeProvider(
  baseUrl: string,
  apiKey: string | undefined,
): Promise<ComponentStatus> {
  const base = baseUrl.endsWith("/") ? baseUrl : baseUrl + "/";
  let modelsUrl: string;
  try {
    modelsUrl = new URL("models", base).href;
  } catch {
    return { ok: false, detail: "URL du fournisseur invalide" };
  }
  try {
    const response = await fetch(modelsUrl, {
      redirect: "error",
      signal: timeout(MODEL_PROBE_TIMEOUT_MS),
      headers: apiKey ? { Authorization: "Bearer " + apiKey } : {},
    });
    let message: unknown;
    try {
      const body = (await response.json()) as { error?: { message?: unknown }; message?: unknown };
      message = body.error?.message ?? body.message;
    } catch { /* classification without a body is still useful */ }
    const reason = providerReason(response.status, message);
    if (response.ok) return { ok: true, detail: "" };
    if (response.status === 404) return { ok: true, detail: "" };
    return { ok: false, detail: reason };
  } catch (error) {
    const code = error instanceof Error ? error.message : "injoignable";
    return { ok: false, detail: `fournisseur injoignable (${code.replace(/https?:\/\/[^\s]+/g, "[url]")})` };
  }
}

const timeout = (ms = 3000) => AbortSignal.timeout(ms);

async function ping(url: string): Promise<{ ok: boolean; status?: number; error?: string }> {
  try {
    const response = await fetch(url, { redirect: "error", signal: timeout() });
    return { ok: response.ok, status: response.status };
  } catch (error) {
    const code = error instanceof Error ? error.message : "injoignable";
    return { ok: false, error: code.replace(/https?:\/\/[^\s]+/g, "[url]") };
  }
}

/** JSON-RPC answer of a Streamable HTTP endpoint: plain JSON, or the first `data:` event of an SSE body. */
async function toolsListPayload(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!(response.headers.get("content-type") ?? "").includes("text/event-stream")) return JSON.parse(text);
  for (const line of text.split(/\r?\n/))
    if (line.startsWith("data:")) {
      try { return JSON.parse(line.slice(5)); } catch { /* next event */ }
    }
  return undefined;
}

/** `ok` needs a real `tools/list`: a non-empty array of well-formed tools that carries the whole local catalogue. */
export function checkToolsList(payload: unknown): ComponentStatus {
  const result = (payload as { result?: { tools?: unknown; nextCursor?: unknown } } | undefined)?.result;
  const tools = result?.tools;
  if (!Array.isArray(tools)) return { ok: false, detail: "tools/list invalide : aucun tableau d’outils" };
  if (!tools.length) return { ok: false, detail: "aucun outil MCP" };
  const names = new Set<string>();
  for (const tool of tools) {
    const entry = tool as { name?: unknown; inputSchema?: unknown } | null;
    if (!entry || typeof entry.name !== "string" || !entry.name || !entry.inputSchema || typeof entry.inputSchema !== "object" || Array.isArray(entry.inputSchema))
      return { ok: false, detail: "tools/list invalide : outil mal formé" };
    names.add(entry.name);
  }
  // A paginated answer only shows a page of the catalogue.
  if (result?.nextCursor == null) {
    const missing = catalog.filter((tool) => !names.has(tool.name));
    if (missing.length) return { ok: false, detail: `tools/list incomplet : ${missing.length} outil(s) du catalogue absent(s)` };
  } else if (!catalog.some((tool) => names.has(tool.name))) {
    return { ok: false, detail: "tools/list non conforme au catalogue" };
  }
  return { ok: true, detail: `${tools.length} outils MCP` };
}

export async function probeReadiness(options: ReadinessOptions): Promise<ReadyReport> {
  const database: ComponentStatus = { ok: false, detail: "base injoignable" };
  try {
    await options.pool.query("SELECT 1");
    database.ok = true;
    database.detail = "PostgreSQL joignable";
  } catch (error) {
    database.detail =
      error instanceof Error ? error.message.split("\n")[0]! : "base injoignable";
  }

  const model: ComponentStatus = { ok: false, detail: "AUCUN MODÈLE ACTIF — renseigner MODEL_API_KEY dans .env (voir .env.example) puis relancer" };
  if (database.ok) {
    try {
      const rows = (
        await options.pool.query(
          "SELECT body FROM backend_configurations WHERE resource='models' AND body->>'active'='true' ORDER BY resource_id",
        )
      ).rows;
      if (rows.length === 1) {
        const body = rows[0].body as {
          label?: string;
          model?: string;
          id?: string;
          baseUrl?: string;
          apiKeyRef?: string;
        };
        const label = `${body.label ?? body.id} / ${body.model ?? "modèle"}`;
        const env = options.environment ?? process.env;
        if (body.baseUrl && modelReadinessProbeEnabled(env)) {
          const cacheKey = `${body.id ?? ""}|${body.baseUrl}|${body.apiKeyRef ?? ""}`;
          const now = Date.now();
          let probe: ComponentStatus;
          if (probeCache && probeCache.key === cacheKey && now - probeCache.at < PROBE_TTL_MS) {
            probe = probeCache.result;
          } else {
            probe = await probeProvider(
              body.baseUrl,
              body.apiKeyRef ? env[body.apiKeyRef] : undefined,
            );
            probeCache = { key: cacheKey, at: now, result: probe };
          }
          if (probe.ok) {
            model.ok = true;
            model.detail = label;
          } else {
            model.detail = `${label} — ${probe.detail}`;
          }
        } else {
          model.ok = true;
          model.detail = label;
        }
      } else if (rows.length > 1) {
        model.detail = `${rows.length} modèles actifs (un seul est requis)`;
      }
    } catch {
      model.detail = "lecture des modèles impossible";
    }
  }

  const tooling: ComponentStatus = { ok: false, detail: "TOOLING_URL non configuré" };
  if (options.toolingUrl) {
    const health = await ping(new URL("/health", options.toolingUrl.endsWith("/") ? options.toolingUrl : options.toolingUrl + "/").href);
    if (health.ok) {
      tooling.ok = true;
      tooling.detail = "Tooling joignable";
    } else {
      tooling.detail = health.error
        ? `Tooling injoignable (${health.error})`
        : `Tooling HTTP ${health.status}`;
    }
  }

  const mcpTools: ComponentStatus = { ok: false, detail: "MCP non configuré" };
  if (options.mcpUrl) {
    try {
      let authorization: Record<string, string> = {};
      if (options.mcpToken) {
        try {
          authorization = { Authorization: "Bearer " + (await options.mcpToken()) };
        } catch {
          /* Keycloak unreachable: the oidc line says so, the probe then reports the HTTP refusal. */
        }
      }
      const response = await fetch(options.mcpUrl, {
        method: "POST",
        redirect: "error",
        headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...authorization },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
        signal: timeout(),
      });
      if (response.ok) {
        const verdict = checkToolsList(await toolsListPayload(response));
        mcpTools.ok = verdict.ok;
        mcpTools.detail = verdict.detail;
      } else {
        mcpTools.detail = tooling.ok
          ? `MCP HTTP ${response.status} — ${catalog.length} outils au catalogue local`
          : `MCP HTTP ${response.status}`;
      }
    } catch (error) {
      mcpTools.detail = tooling.ok
        ? `MCP non listé (${error instanceof Error ? error.message : "erreur"}) — catalogue local ${catalog.length} outils`
        : "MCP injoignable";
    }
  } else if (tooling.ok) {
    mcpTools.detail = `MCP_ALLOWED_URLS absent — catalogue local ${catalog.length} outils`;
  }

  const xroad: ComponentStatus = { ok: false, detail: "XROAD_URL non configuré" };
  if (options.xroadUrl) {
    const health = await ping(new URL("/health", options.xroadUrl.endsWith("/") ? options.xroadUrl : options.xroadUrl + "/").href);
    if (health.ok) {
      xroad.ok = true;
      xroad.detail = "X-Road joignable";
    } else {
      xroad.detail = health.error
        ? `X-Road injoignable (${health.error})`
        : `X-Road HTTP ${health.status}`;
    }
  }

  const oidc: ComponentStatus = { ok: false, detail: "OIDC_JWKS_URL non configuré" };
  if (options.oidcJwksUrl) {
    const health = await ping(options.oidcJwksUrl);
    if (health.ok) {
      oidc.ok = true;
      oidc.detail = "Keycloak/JWKS joignable";
    } else {
      oidc.detail = health.error
        ? `JWKS injoignable (${health.error})`
        : `JWKS HTTP ${health.status}`;
    }
  }

  const status = [database, model, tooling, mcpTools, xroad, oidc].every((item) => item.ok)
    ? "ok"
    : "degraded";
  return { status, model, tooling, mcpTools, xroad, oidc, database };
}

export function logReadiness(report: ReadyReport): void {
  const line = (ok: boolean, label: string, detail: string) =>
    console.log(`${ok ? "✔" : "✘"} ${label} : ${detail}`);
  line(report.model.ok, "Modèle", report.model.detail);
  line(report.tooling.ok, "Tooling", report.tooling.detail);
  line(report.mcpTools.ok, "MCP", report.mcpTools.detail);
  line(report.xroad.ok, "X-Road", report.xroad.detail);
  line(report.oidc.ok, "Keycloak/JWKS", report.oidc.detail);
  line(report.database.ok, "Base", report.database.detail);
}
