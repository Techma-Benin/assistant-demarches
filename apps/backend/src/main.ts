import { readFile } from "node:fs/promises";
import { createLocalJWKSet, importPKCS8 } from "jose";
import { createBackend } from "./app.js";
import { remoteAuth } from "./auth.js";
import { database } from "./database.js";
import { loadRuntime } from "./runtime.js";
import { logReadiness, probeReadiness } from "./readiness.js";
import { publicSigningJwk } from "./signing-jwks.js";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}
const port = Number(process.env.PORT ?? "4010");
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("Invalid PORT.");
const issuer = required("OIDC_ISSUER");
const jwksUrl =
  process.env.OIDC_JWKS_URL ??
  new URL("protocol/openid-connect/certs", issuer.endsWith("/") ? issuer : issuer + "/").href;
const auth = remoteAuth(issuer, jwksUrl);
const pem = await readFile(required("SIGNING_KEY_FILE"), "utf8");
const signing = await importPKCS8(pem, "RS256");
const publicJwk = await publicSigningJwk(pem);
auth.guestIssuer = required("PUBLIC_URL");
auth.guestKey = createLocalJWKSet({ keys: [publicJwk] });
const pool = database(required("DATABASE_URL"));
const allowedMcpUrls = new Set(
  (process.env.MCP_ALLOWED_URLS ?? "")
    .split(",")
    .filter(Boolean)
    .map((value) => new URL(value.trim()).href),
);
const corsOrigins = (process.env.CORS_ORIGINS ?? process.env.CORS_ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const stopAgent = new AbortController();
let agentLoop: Promise<void> | undefined;
let app: Awaited<ReturnType<typeof createBackend>> | undefined;
try {
  const { runtime, agent } = await loadRuntime(pool, auth, allowedMcpUrls, signing);
  agentLoop = agent.watch(stopAgent.signal);
  const readiness = {
    pool,
    toolingUrl: process.env.TOOLING_URL,
    mcpUrl: process.env.TOOLING_MCP_URL ?? [...allowedMcpUrls][0],
    xroadUrl: process.env.XROAD_URL,
    oidcJwksUrl: jwksUrl,
  };
  app = await createBackend({
    pool,
    auth,
    allowedMcpUrls,
    corsOrigins,
    runtime,
    jwks: { keys: [publicJwk as Record<string, unknown>] },
    readiness,
  });
  await app.listen(port, process.env.HOST ?? "127.0.0.1");
  console.log(`Backend listening on port ${port}.`);
  await probeReadiness(readiness)
    .then(logReadiness)
    .catch((error) =>
      console.error(
        error instanceof Error ? error.message : "Diagnostic de démarrage indisponible.",
      ),
    );
  const shutdown = async () => {
    stopAgent.abort();
    await agentLoop;
    await app?.close();
    await pool.end();
  };
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.once(signal, () => {
      void shutdown().then(
        () => process.exit(0),
        () => process.exit(1),
      );
    });
} catch (error) {
  stopAgent.abort();
  await agentLoop?.catch(() => undefined);
  await app?.close().catch(() => undefined);
  await pool.end();
  console.error(error instanceof Error ? error.message : "Backend startup failed; check configuration and database.");
  process.exit(1);
}
