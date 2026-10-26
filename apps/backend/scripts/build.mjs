import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
rmSync(new URL("dist/", root), { recursive: true, force: true });
execFileSync(
  process.execPath,
  [
    fileURLToPath(new URL("node_modules/typescript/bin/tsc", root)),
    "-p",
    fileURLToPath(new URL("tsconfig.json", root)),
  ],
  { stdio: "inherit" },
);
const assets = new URL("dist/apps/backend/src/assets/", root);
mkdirSync(assets, { recursive: true });
cpSync(
  new URL("../../../contracts/v1/domain.schema.json", import.meta.url),
  new URL("domain.schema.json", assets),
);
cpSync(
  new URL("../../../contracts/v1/mcp.tools.json", import.meta.url),
  new URL("mcp.tools.json", assets),
);
cpSync(
  new URL("../../../prompts/", import.meta.url),
  new URL("prompts/", assets),
  { recursive: true },
);
cpSync(new URL("migrations/", root), new URL("migrations/", assets), {
  recursive: true,
});

for (const name of ["conversation", "admin", "events", "backend-resources"]) {
  cpSync(new URL(`../../../contracts/v1/${name}.openapi.json`, import.meta.url), new URL(`${name}.openapi.json`, assets));
}

cpSync(new URL("docs/testing.md", root), new URL("testing.md", assets));
