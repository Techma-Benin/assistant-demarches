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
const auth = remoteAuth(required("OIDC_ISSUER"), required("OIDC_JWKS_URL"));
const pool = database(required("DATABASE_URL"));
const allowedMcpUrls = new Set(
  (process.env.MCP_ALLOWED_URLS ?? "")
    .split(",")
    .filter(Boolean)
    .map((value) => new URL(value.trim()).href),
);
const corsOrigins = (process.env.CORS_ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
try {
  const { runtime } = await loadRuntime(pool, auth, allowedMcpUrls);
  const app = await createBackend({
    pool,
    auth,
    allowedMcpUrls,
    corsOrigins,
    runtime,
  });
  await app.listen(port, process.env.HOST ?? "127.0.0.1");
  console.log(`Backend listening on port ${port}.`);
  for (const signal of ["SIGINT", "SIGTERM"])
    process.once(signal, async () => {
      await app.close();
      await pool.end();
    });
} catch {
  await pool.end();
  console.error("Backend startup failed; check configuration and database.");
  process.exitCode = 1;
}
