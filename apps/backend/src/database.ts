import { readFileSync, readdirSync } from "node:fs";
import { Pool } from "pg";
import type { Config, Resource } from "./domain.js";
import { configId, validate } from "./domain.js";

export function database(connectionString: string): Pool {
  return new Pool({
    connectionString,
    max: 10,
    connectionTimeoutMillis: 5000,
    statement_timeout: 10000,
  });
}
export async function migrate(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('techma-backend-migrations', 0))",
    );
    await client.query(
      "CREATE TABLE IF NOT EXISTS backend_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    const directory = new URL("./assets/migrations/", import.meta.url);
    for (const name of readdirSync(directory)
      .filter((name) => name.endsWith(".sql"))
      .sort()) {
      if (
        (
          await client.query("SELECT 1 FROM backend_migrations WHERE name=$1", [
            name,
          ])
        ).rowCount
      )
        continue;
      await client.query(readFileSync(new URL(name, directory), "utf8"));
      await client.query("INSERT INTO backend_migrations (name) VALUES ($1)", [
        name,
      ]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
// Deployment provisioning only; C3 PUT must never implicitly create resources.
export async function provision(
  pool: Pool,
  administrationId: string,
  resource: Resource,
  body: Config,
): Promise<void> {
  validate(
    resource === "models"
      ? "ModelConfig"
      : resource === "tools"
        ? "ToolConfig"
        : "Procedure",
    body,
  );
  if (
    resource === "procedures" &&
    "administrationId" in body &&
    body.administrationId !== administrationId
  )
    throw new Error("Procedure administration mismatch.");
  await pool.query(
    "INSERT INTO backend_configurations (administration_id, resource, resource_id, body) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING",
    [administrationId, resource, configId(body), body],
  );
}
