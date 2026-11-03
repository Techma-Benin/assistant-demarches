import { McpConnections, type McpServer } from "./mcp-connections.js";
import { readFileSync } from "node:fs";
import { database, migrate, provision } from "./database.js";
import { validate, type ModelConfig } from "./domain.js";

const connection = process.env.DATABASE_URL;
if (!connection) throw new Error("DATABASE_URL required.");
const pool = database(connection);
try {
  if (process.argv[2] === "migrate") await migrate(pool);
  else if (process.argv[2] === "seed" && process.argv[3]) {
    const seed = JSON.parse(readFileSync(process.argv[3], "utf8")) as {
      administrationId?: string;
      models?: ModelConfig[];
      mcpServers?: McpServer[];
    };
    if (!seed.administrationId || !Array.isArray(seed.models))
      throw new Error("Invalid provisioning file.");
    if (seed.mcpServers !== undefined && !Array.isArray(seed.mcpServers))
      throw new Error("Invalid provisioning file.");
    const allowed = new Set(
      (process.env.MCP_ALLOWED_URLS ?? "")
        .split(",")
        .filter(Boolean)
        .map((value) => new URL(value.trim()).href),
    );
    const connections = new McpConnections(pool, allowed);
    for (const server of seed.mcpServers ?? []) connections.validate(server);
    for (const model of seed.models) validate("ModelConfig", model);
    for (const model of seed.models)
      await provision(pool, seed.administrationId, "models", model);
    for (const server of seed.mcpServers ?? [])
      await pool.query(
        "INSERT INTO backend_mcp_servers(administration_id,id,body) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
        [seed.administrationId, server.id, server],
      );
  } else throw new Error("Usage: cli.js migrate | seed <file.json>");
  console.log("Database command completed.");
} finally {
  await pool.end();
}
