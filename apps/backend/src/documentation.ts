import { describeSpecification } from "./documentation-guide.js";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { static as serveStatic, type Express } from "express";

const require = createRequire(import.meta.url);
const documents = ["conversation", "admin", "events", "backend-resources"];

/** Serve the existing contracts; API authentication remains enforced by the routes. */
export function attachDocumentation(server: Express) {
  const specifications = new Map(documents.map((name) => {
    const spec = JSON.parse(readFileSync(new URL(`./assets/${name}.openapi.json`, import.meta.url), "utf8"));
    return [name, describeSpecification(name, spec)];
  }));
  server.get("/docs/guide", (_req, res) => {
    const guide = readFileSync(new URL("./assets/testing.md", import.meta.url), "utf8");
    res.setHeader("Cache-Control", "no-store");
    res.type("text/plain").send(guide);
  });
  server.get("/docs/openapi/:name.json", (req, res) => {
    const spec = specifications.get(req.params.name);
    res.setHeader("Cache-Control", "no-store");
    if (!spec) { res.status(404).json({ error: "Unknown specification" }); return; }
    res.json(spec);
  });
  server.use("/docs/assets", serveStatic(dirname(require.resolve("swagger-ui-dist/package.json")), { index: false }));
  server.get(["/docs", "/docs/"], (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.type("html").send(`<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Backend API — Swagger UI</title><link rel="stylesheet" href="/docs/assets/swagger-ui.css"></head>
<body><div id="swagger-ui"></div><script src="/docs/assets/swagger-ui-bundle.js"></script>
<script src="/docs/assets/swagger-ui-standalone-preset.js"></script>
<script>SwaggerUIBundle({url:"/docs/openapi/conversation.json",presets:[SwaggerUIBundle.presets.apis,SwaggerUIStandalonePreset],layout:"StandaloneLayout",dom_id:'#swagger-ui',urls:${JSON.stringify(documents.map(name => ({ name, url: `/docs/openapi/${name}.json` })))},deepLinking:true,persistAuthorization:false,validatorUrl:null});</script></body></html>`);
  });
}
