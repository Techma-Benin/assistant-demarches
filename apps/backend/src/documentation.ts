import { describeSpecification } from "./documentation-guide.js";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { static as serveStatic, type Express } from "express";

const require = createRequire(import.meta.url);
const documents = ["conversation", "admin", "events", "backend-resources", "department-admin", "tooling-admin"];

/** Serve the existing contracts; API authentication remains enforced by the routes. */
export function attachDocumentation(server: Express, developmentTokens?: Record<string, string>) {
  if (developmentTokens) server.get("/docs/development-auth/:role", (req, res) => {
    const host = (req.get("host") ?? "").replace(/:\d+$/, "");
    if (!["localhost", "127.0.0.1", "[::1]"].includes(host)) { res.sendStatus(403); return; }
    res.setHeader("Cache-Control", "no-store");
    const token = Object.hasOwn(developmentTokens, req.params.role) ? developmentTokens[req.params.role] : undefined;
    if (!token) { res.sendStatus(404); return; }
    res.json({ token });
  });
  const specifications = new Map(documents.map((name) => {
    const spec = JSON.parse(readFileSync(new URL(`./assets/${name}.openapi.json`, import.meta.url), "utf8"));
    const documented = name === "department-admin" || name === "tooling-admin" ? spec : describeSpecification(name, spec);
    if (developmentTokens) documented.info.description = "**Test local prêt :** cliquez sur **Tester comme usager** en haut pour les conversations, ou **Tester comme administrateur** pour la configuration. Le jeton est rempli automatiquement. Puis Try it out → Execute.\n\n" + documented.info.description;
    return [name, documented];
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
<body>${developmentTokens ? `<aside style="padding:16px;background:#eef5ff;font-family:sans-serif">
<strong>Connexion de test locale</strong> — Choisissez un rôle avant d’essayer une route.
<button type="button" onclick="connectDevelopment('user')">Tester comme usager</button>
<button type="button" onclick="connectDevelopment('admin')">Tester comme administrateur</button>
<span id="development-status" role="status"></span>
<p>Pour commencer : usager → créer une conversation → envoyer un message → lire les événements. Ces essais écrivent dans votre base locale. Les réponses IA nécessitent encore le worker et un modèle.</p></aside>` : ""}<div id="swagger-ui"></div><script src="/docs/assets/swagger-ui-bundle.js"></script>
<script src="/docs/assets/swagger-ui-standalone-preset.js"></script>
<script>const ui = SwaggerUIBundle({url:"/docs/openapi/conversation.json",presets:[SwaggerUIBundle.presets.apis,SwaggerUIStandalonePreset],layout:"StandaloneLayout",dom_id:'#swagger-ui',urls:${JSON.stringify(documents.map(name => ({ name, url: `/docs/openapi/${name}.json` })))},deepLinking:true,persistAuthorization:false,validatorUrl:null${developmentTokens ? `,requestInterceptor: request => {
 if (request.loadSpec) return request;
 const headers = request.headers || (request.headers = {});
 if (!headers.traceparent || headers.traceparent === '00-12345678901234567890123456789012-1234567890123456-01') headers.traceparent = '00-' + crypto.randomUUID().replaceAll('-', '') + '-' + crypto.randomUUID().replaceAll('-', '').slice(0,16) + '-01';
 if (!headers['Idempotency-Key'] || headers['Idempotency-Key'].startsWith('manual-')) headers['Idempotency-Key'] = crypto.randomUUID();
 return request;
}` : ""}});
${developmentTokens ? `async function connectDevelopment(role) {
 const status = document.getElementById('development-status');
 try {
  const response = await fetch('/docs/development-auth/' + role);
  if (!response.ok) throw new Error('Connexion de test indisponible');
  const {token} = await response.json();
  ui.preauthorizeApiKey('bearerAuth', token);
  status.textContent = role === 'user' ? ' Connecté comme usager : vous pouvez créer une conversation.' : ' Connecté comme administrateur : choisissez le contrat admin.';
 } catch { status.textContent = ' Impossible de se connecter. Relancez pnpm dev puis rechargez cette page.'; }
}` : ""}</script></body></html>`);
  });
}
