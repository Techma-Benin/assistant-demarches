import { McpConnections, type McpServer } from "./mcp-connections.js";
import { readFileSync } from "node:fs";
import { database, migrate, provision } from "./database.js";
import { seedDirectory } from "./directory-seed.js";
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
      administrationId?: string;
      models?: ModelConfig[];
      tools?: ToolConfig[];
      mcpServers?: McpServer[];
      procedures?: Schemas["Procedure"][];
      departments?: unknown;
      users?: unknown;
    };
    const catalog = Boolean(seed.administrationId && Array.isArray(seed.models));
    const directory = seed.departments !== undefined || seed.users !== undefined;
    if (!catalog && !directory)
      throw new Error("Invalid provisioning file.");
    if (catalog && (
      (seed.tools !== undefined && !Array.isArray(seed.tools)) ||
      (seed.mcpServers !== undefined && !Array.isArray(seed.mcpServers))
    ))
      throw new Error("Invalid provisioning file.");
    if (catalog) {
      const allowed = new Set(
        (process.env.MCP_ALLOWED_URLS ?? "")
          .split(",")
          .filter(Boolean)
          .map((value) => new URL(value.trim()).href),
      );
      const connections=new McpConnections(pool,allowed);
      for(const server of seed.mcpServers??[]) connections.validate(server);
      // Validate the whole file before applying any provisioning writes.
      for (const model of seed.models!) validate("ModelConfig", model);
      for (const procedure of seed.procedures ?? []) {
        validate("Procedure", procedure);
        if (procedure.administrationId !== seed.administrationId)
          throw new Error("Procedure administration mismatch.");
      }
      for (const tool of seed.tools ?? []) {
        validate("ToolConfig", tool);
        if (!approvedMcpUrl(tool.serverUrl, allowed))
          throw new Error("MCP URL not approved.");
      }
      for (const model of seed.models!)
        await provision(pool, seed.administrationId!, "models", model);
      for (const tool of seed.tools ?? [])
        await provision(pool, seed.administrationId!, "tools", tool);
      for(const server of seed.mcpServers??[]) await pool.query("INSERT INTO backend_mcp_servers(administration_id,id,body) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",[seed.administrationId,server.id,server]);
      for (const procedure of seed.procedures ?? [])
        await provision(pool, seed.administrationId!, "procedures", procedure);
    }
    if (directory) await seedDirectory(pool, seed);
  } else throw new Error("Usage: cli.js migrate | seed <file.json>");
  console.log("Database command completed.");
} finally {
  await pool.end();
}
