import { readFile } from "node:fs/promises";
import { createLocalJWKSet, exportJWK, importPKCS8 } from "jose";
import { createBackend } from "./app.js";
import { remoteAuth } from "./auth.js";
import { database } from "./database.js";
import { loadRuntime } from "./runtime.js";

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
const signing = await importPKCS8(await readFile(required("SIGNING_KEY_FILE"), "utf8"), "RS256");
const publicJwk = await exportJWK(signing);
publicJwk.alg = "RS256";
publicJwk.use = "sig";
publicJwk.kid = "backend-signing";
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
try {
  const { runtime, agent } = await loadRuntime(pool, auth, allowedMcpUrls);
  const stopAgent = new AbortController();
  agent.watch(stopAgent.signal);
  const app = await createBackend({
    pool,
    auth,
    allowedMcpUrls,
    corsOrigins,
    runtime,
    jwks: { keys: [publicJwk as Record<string, unknown>] },
  });
  await app.listen(port, process.env.HOST ?? "127.0.0.1");
  console.log(`Backend listening on port ${port}.`);
  for (const signal of ["SIGINT", "SIGTERM"])
    process.once(signal, async () => {
      stopAgent.abort();
      await app.close();
      await pool.end();
    });
} catch (error) {
  await pool.end();
  console.error(error instanceof Error ? error.message : "Backend startup failed; check configuration and database.");
  process.exitCode = 1;
}
