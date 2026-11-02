import type { Pool } from "pg";
import { catalog } from "./tooling.js";

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
};

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
        const body = rows[0].body as { label?: string; model?: string; id?: string };
        model.ok = true;
        model.detail = `${body.label ?? body.id} / ${body.model ?? "modèle"}`;
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
        const payload = (await response.json()) as { result?: { tools?: unknown[] } };
        const count = Array.isArray(payload.result?.tools) ? payload.result.tools.length : catalog.length;
        mcpTools.ok = count > 0;
        mcpTools.detail = mcpTools.ok ? `${count} outils MCP` : "aucun outil MCP";
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
