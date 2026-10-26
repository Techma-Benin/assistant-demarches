import { readFileSync } from "node:fs";
import { database, migrate, provision } from "./database.js";
import {
  approvedMcpUrl,
  validate,
  type ModelConfig,
  type ToolConfig,
  type Schemas,
} from "./domain.js";

const connection = process.env.DATABASE_URL;
if (!connection) throw new Error("DATABASE_URL required.");
const pool = database(connection);
try {
  if (process.argv[2] === "migrate") await migrate(pool);
  else if (process.argv[2] === "seed" && process.argv[3]) {
    const seed = JSON.parse(readFileSync(process.argv[3], "utf8")) as {
      administrationId: string;
      models: ModelConfig[];
      tools: ToolConfig[];
      procedures?: Schemas["Procedure"][];
    };
    if (
      !seed.administrationId ||
      !Array.isArray(seed.models) ||
      !Array.isArray(seed.tools)
    )
      throw new Error("Invalid provisioning file.");
    const allowed = new Set(
      (process.env.MCP_ALLOWED_URLS ?? "")
        .split(",")
        .filter(Boolean)
        .map((value) => new URL(value.trim()).href),
    );
    // Validate the whole file before applying any provisioning writes.
    for (const model of seed.models) validate("ModelConfig", model);
    for (const procedure of seed.procedures ?? []) {
      validate("Procedure", procedure);
      if (procedure.administrationId !== seed.administrationId)
        throw new Error("Procedure administration mismatch.");
    }
    for (const tool of seed.tools) {
      validate("ToolConfig", tool);
      if (!approvedMcpUrl(tool.serverUrl, allowed))
        throw new Error("MCP URL not approved.");
    }
    for (const model of seed.models)
      await provision(pool, seed.administrationId, "models", model);
    for (const tool of seed.tools)
      await provision(pool, seed.administrationId, "tools", tool);
    for (const procedure of seed.procedures ?? [])
      await provision(pool, seed.administrationId, "procedures", procedure);
  } else throw new Error("Usage: cli.js migrate | seed <file.json>");
  console.log("Database command completed.");
} finally {
  await pool.end();
}
