import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import { generateKeyPairSync } from "node:crypto";
import { generateKeyPair, exportJWK, importPKCS8, SignJWT, createLocalJWKSet } from "jose";
import { isolatedDatabase } from "./helpers.mjs";
import { database, migrate } from "../dist/apps/backend/src/database.js";
import { createBackend } from "../dist/apps/backend/src/app.js";
import { loadRuntime } from "../dist/apps/backend/src/runtime.js";
import { remoteAuth } from "../dist/apps/backend/src/auth.js";
import { publicSigningJwk } from "../dist/apps/backend/src/signing-jwks.js";
import { identifier } from "../dist/apps/backend/src/domain.js";

const CASIER = "PS00373";
const JUSTICE_AGENT = "7f3c2a10-0002-4000-8000-000000000002";
const tp = "00-" + "a".repeat(32) + "-" + "b".repeat(16) + "-01";
const toolingRequire = createRequire(new URL("../../tooling/package.json", import.meta.url));
const catalogueFile = fileURLToPath(new URL("../../../content/service-public/catalogue.json", import.meta.url));

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
    server.on("error", reject);
  });
}

async function listenHttp(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, url: "http://127.0.0.1:" + server.address().port };
}

function sse(res, message) {
  const events = message.tool_calls
    ? message.tool_calls.map((call, index) => ({
        choices: [{ delta: { tool_calls: [{ index, id: call.id, type: call.type, function: call.function }] } }],
      }))
    : [{ choices: [{ delta: { content: message.content ?? "" } }] }];
  res.writeHead(200, { "content-type": "text/event-stream" });
  res.end(events.map((event) => "data: " + JSON.stringify(event)).join("\n\n") + "\n\ndata: [DONE]\n");
}

test("real Tooling v2 + X-Road sim: guest create → loginRequired → attach → consent → mandate → requestCard → submit → case.updated → document", { timeout: 180000 }, async (t) => {
  const pg = await isolatedDatabase();
  const pool = database(pg.connection);
  const filesDir = mkdtempSync(join(tmpdir(), "techma-tooling-v2-files-"));
  t.after(async () => {
    await pool.end();
    await pg.close();
    rmSync(filesDir, { recursive: true, force: true });
  });
  await migrate(pool);

  const { PGlite } = await import(pathToFileURL(toolingRequire.resolve("@electric-sql/pglite")).href);
  const { createApp } = await import(new URL("../../tooling/dist/src/app.js", import.meta.url).href);
  const { loadConfig } = await import(new URL("../../tooling/dist/src/config.js", import.meta.url).href);
  const { CaseTracker } = await import(new URL("../../tooling/dist/src/tracking/case-tracker.js", import.meta.url).href);
  const { OutboxPublisher } = await import(new URL("../../tooling/dist/src/events/outbox-publisher.js", import.meta.url).href);
  const { Database } = await import(new URL("../../tooling/dist/src/database/database.js", import.meta.url).href);
  const { createXroadServer } = await import(new URL("../../xroad-sim/dist/src/server.js", import.meta.url).href);
  const { loadConfig: loadXroadConfig } = await import(new URL("../../xroad-sim/dist/src/config.js", import.meta.url).href);

  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const realmJwk = { ...(await exportJWK(publicKey)), kid: "realm-key", alg: "RS256", use: "sig" };
  let keycloakIssuer = "";
  const signService = (claims, audience) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: "RS256", kid: "realm-key" })
      .setIssuer(keycloakIssuer)
      .setAudience(audience)
      .setSubject(typeof claims.azp === "string" ? claims.azp : "service")
      .setIssuedAt()
      .setExpirationTime("10m")
      .sign(privateKey);
  const keycloak = await listenHttp(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname.endsWith("/protocol/openid-connect/certs")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ keys: [realmJwk] }));
      return;
    }
    if (url.pathname.endsWith("/protocol/openid-connect/token") && req.method === "POST") {
      let body = "";
      for await (const chunk of req) body += chunk;
      const form = new URLSearchParams(body);
      const okSecret =
        (form.get("client_id") === "backend" && form.get("client_secret") === "backend-test") ||
        (form.get("client_id") === "tooling" && form.get("client_secret") === "tooling-test");
      if (form.get("grant_type") !== "client_credentials" || !okSecret) {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "invalid_client" }));
        return;
      }
      const backend = form.get("client_id") === "backend";
      const token = await signService(
        {
          azp: form.get("client_id"),
          scope: backend
            ? form.get("scope") || "tools:call mandates:grant xroad:apply xroad:administer"
            : "events:publish files:read xroad:apply",
        },
        backend ? ["techma-tooling", "techma-xroad"] : ["techma-backend", "techma-xroad"],
      );
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ access_token: token, expires_in: 300, token_type: "Bearer" }));
      return;
    }
    res.writeHead(404);
    res.end("{}");
  });
  t.after(() => new Promise((resolve) => { keycloak.server.closeAllConnections(); keycloak.server.close(resolve); }));
  keycloakIssuer = keycloak.url + "/realms/techma";

  const journey = { requestId: null, fileId: null };
  const model = await listenHttp(async (req, res) => {
    if (req.url !== "/v1/chat/completions" || req.method !== "POST") {
      res.writeHead(404);
      res.end("{}");
      return;
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    const messages = body.messages ?? [];
    const last = messages.at(-1);
    const lastUser = [...messages].reverse().find((item) => item.role === "user");
    const text = typeof lastUser?.content === "string" ? lastUser.content : "";
    if (last?.role === "tool") {
      let failed = false;
      try {
        failed = JSON.parse(last.content)?.isError === true;
      } catch {
        failed = true;
      }
      if (failed) {
        sse(res, { content: JSON.stringify({ blocks: [{ type: "text", text: "Action à confirmer.", sources: [] }] }) });
        return;
      }
      sse(res, { content: JSON.stringify({ blocks: [{ type: "text", text: "Étape enregistrée.", sources: [] }] }) });
      return;
    }
    const call = (name, args) => ({
      content: null,
      tool_calls: [{ id: "call-" + name.replaceAll(".", "-"), type: "function", function: { name: name.replaceAll(".", "_"), arguments: JSON.stringify(args) } }],
    });
    if (/joindre|pièce/i.test(text) && journey.requestId && journey.fileId) {
      sse(res, call("documents.attach", { requestId: journey.requestId, documentType: "extrait-acte-naissance", fileId: journey.fileId }));
      return;
    }
    if (/renseigner|champs/i.test(text) && journey.requestId) {
      sse(res, call("request.update", {
        requestId: journey.requestId,
        fields: [
          { name: "adresseDomicile", value: "Cotonou, Akpakpa", source: "answer" },
          { name: "profession", value: "Enseignante", source: "answer" },
          { name: "nombreEnfantsACharge", value: 2, source: "answer" },
          { name: "situationMatrimoniale", value: "Mariée", source: "answer" },
        ],
      }));
      return;
    }
    if (/soumettre|déposer le dossier/i.test(text) && journey.requestId) {
      sse(res, call("request.submit", { requestId: journey.requestId }));
      return;
    }
    if (/payer/i.test(text) && journey.requestId) {
      sse(res, call("request.pay", { requestId: journey.requestId }));
      return;
    }
    sse(res, call("request.create", { procedureId: CASIER }));
  });
  t.after(() => new Promise((resolve) => { model.server.closeAllConnections(); model.server.close(resolve); }));

  const xroadLite = await PGlite.create();
  t.after(() => xroadLite.close());
  const xroadDb = {
    transaction: (fn) => xroadLite.transaction(async (raw) => fn({ query: async (sql, params) => (await raw.query(sql, params)).rows })),
    close: async () => {},
  };
  const xroad = await createXroadServer(
    loadXroadConfig({ XROAD_PORT: "0", OIDC_ISSUER: keycloakIssuer, DATABASE_URL: "postgres://unused", CATALOGUE_FILE: catalogueFile }),
    xroadDb,
  ).listen();
  t.after(() => xroad.close());

  const backendPort = await freePort();
  const publicUrl = "http://127.0.0.1:" + backendPort;
  const toolingPort = await freePort();
  const toolingUrl = "http://127.0.0.1:" + toolingPort;
  const mcpUrl = toolingUrl + "/mcp";

  const nodeSigning = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const signingPem = nodeSigning.privateKey.export({ type: "pkcs8", format: "pem" });
  const signingKey = await importPKCS8(signingPem, "RS256");
  const publicJwk = await publicSigningJwk(signingPem);
  const auth = remoteAuth(keycloakIssuer, keycloakIssuer + "/protocol/openid-connect/certs");
  auth.guestIssuer = publicUrl;
  auth.guestKey = createLocalJWKSet({ keys: [publicJwk] });

  process.env.PUBLIC_URL = publicUrl;
  process.env.OIDC_ISSUER = keycloakIssuer;
  process.env.OIDC_CLIENT_ID = "backend";
  process.env.OIDC_CLIENT_SECRET = "backend-test";
  process.env.TOOLING_URL = toolingUrl;
  process.env.TOOLING_MCP_URL = mcpUrl;
  process.env.XROAD_URL = xroad.url + "/";
  process.env.FILE_STORAGE_DIR = filesDir;
  process.env.MODEL_API_KEY = "test-model-key";
  process.env.MODEL_BASE_URL = model.url + "/v1";
  process.env.MODEL_NAME = "fake-model";
  process.env.MCP_ALLOWED_URLS = mcpUrl;

  const { runtime, agent } = await loadRuntime(pool, auth, new Set([mcpUrl]), signingKey);
  const app = await createBackend({
    pool,
    auth,
    allowedMcpUrls: new Set([mcpUrl]),
    runtime,
    jwks: { keys: [publicJwk] },
  });
  await app.listen(backendPort, "127.0.0.1");
  t.after(() => app.close());

  process.env.NODE_ENV = "test";
  const toolingApp = await createApp(
    loadConfig({
      NODE_ENV: "test",
      TOOLING_HOST: "127.0.0.1",
      TOOLING_PORT: String(toolingPort),
      DATABASE_URL: "pglite:memory",
      OIDC_ISSUER: keycloakIssuer,
      OIDC_CLIENT_ID: "tooling",
      OIDC_CLIENT_SECRET: "tooling-test",
      BACKEND_URL: publicUrl,
      BACKEND_JWKS_URL: publicUrl + "/.well-known/jwks.json",
      PROOF_ISSUER: publicUrl,
      XROAD_URL: xroad.url,
      EVENTS_PUBLISHER: "on",
      EVENTS_INTERVAL_MS: "50",
      TRACKING_WORKER: "off",
      TRACKING_POLL_MS: "20",
    }),
    { shutdownHooks: false },
  );
  await toolingApp.listen(toolingPort, "127.0.0.1");
  t.after(() => toolingApp.close());
  const tracker = toolingApp.get(CaseTracker);
  const publisher = toolingApp.get(OutboxPublisher);
  const toolingDb = toolingApp.get(Database);

  const citizenToken = () =>
    new SignJWT({ scope: "citizen" })
      .setProtectedHeader({ alg: "RS256", kid: "realm-key" })
      .setSubject("portal-user")
      .setIssuer(keycloakIssuer)
      .setAudience("techma-backend")
      .setIssuedAt()
      .setExpirationTime("10m")
      .sign(privateKey);
  const officialToken = () =>
    signService({ azp: "backend", scope: "xroad:administer" }, "techma-xroad");

  const request = async (path, { method = "GET", body, bearer, headers = {}, raw = false } = {}) => {
    const binary = Buffer.isBuffer(body);
    const res = await fetch(publicUrl + path, {
      method,
      headers: {
        ...(bearer ? { Authorization: "Bearer " + bearer } : {}),
        traceparent: tp,
        "Idempotency-Key": identifier("key"),
        ...(body && !binary ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      body: body ? (binary ? body : JSON.stringify(body)) : undefined,
    });
    const buffer = Buffer.from(await res.arrayBuffer());
    const text = buffer.toString("utf8");
    const value = !raw && text && (res.headers.get("content-type") ?? "").includes("json") ? JSON.parse(text) : null;
    return { status: res.status, value, text, buffer, headers: res.headers };
  };
  const lastBlocks = async (cid) =>
    (await pool.query(
      "SELECT body->'data'->'message'->'blocks' AS blocks FROM backend_conversation_events WHERE conversation_id=$1 AND body->'data'->>'kind'='message.sent' ORDER BY seq DESC LIMIT 1",
      [cid],
    )).rows[0]?.blocks ?? [];
  const ask = async (bearer, cid, text) => {
    const message = { id: identifier("msg"), content: { type: "text", text }, sentAt: new Date().toISOString() };
    const accepted = await request("/v1/conversations/" + cid + "/messages", { method: "POST", body: message, bearer });
    assert.equal(accepted.status, 202, accepted.text);
    await agent.process(cid);
    return lastBlocks(cid);
  };

  const guestSession = await request("/v1/guest-sessions", { method: "POST" });
  assert.equal(guestSession.status, 201, guestSession.text);
  const guestToken = guestSession.value.token;
  const created = await request("/v1/conversations", { method: "POST", body: { locale: "fr" }, bearer: guestToken });
  assert.equal(created.status, 201, created.text);
  const cid = created.value.id;

  const asGuest = await ask(guestToken, cid, "Je veux déposer un casier judiciaire");
  assert.equal(asGuest.some((block) => block.type === "loginRequired"), true, JSON.stringify(asGuest));

  const citizen = await citizenToken();
  const attached = await request("/v1/conversations/" + cid + "/attach", { method: "POST", body: { guestToken }, bearer: citizen });
  assert.equal(attached.status, 200, attached.text);

  const afterLogin = await ask(citizen, cid, "Créer la demande de casier judiciaire");
  const consent = afterLogin.find((block) => block.type === "consent");
  assert.equal(consent?.type, "consent", JSON.stringify(afterLogin));
  assert.ok(consent.challenge.scopes.includes("requests:write"));
  assert.ok(consent.challenge.scopes.includes("documents:write"));
  assert.ok(consent.challenge.scopes.includes("requests:submit"));

  const granted = await request("/v1/conversations/" + cid + "/mandates", {
    method: "POST",
    body: { challengeId: consent.challenge.id, accepted: true },
    bearer: citizen,
  });
  assert.equal(granted.status, 201, granted.text);
  assert.equal(granted.value.status, "active");

  const createdRequest = await ask(citizen, cid, "Relancer la création du casier");
  const requestCard = createdRequest.find((block) => block.type === "requestCard");
  assert.equal(requestCard?.type, "requestCard", JSON.stringify(createdRequest));
  journey.requestId = requestCard.request.id;
  assert.equal(createdRequest.some((block) => block.type === "fileRequest"), true);

  const filled = await ask(citizen, cid, "Renseigner les champs du formulaire");
  assert.equal(filled.find((block) => block.type === "requestCard")?.request.missing.length, 1);

  const uploaded = await request("/v1/files", {
    method: "POST",
    body: Buffer.from("%PDF-1.4 pièce casier\n"),
    bearer: citizen,
    headers: { "Content-Type": "application/octet-stream", "X-File-Mime-Type": "application/pdf" },
  });
  assert.equal(uploaded.status, 201, uploaded.text);
  journey.fileId = uploaded.value.id;

  const attachedDoc = await ask(citizen, cid, "Joindre la pièce d'identité au dossier");
  assert.equal(attachedDoc.find((block) => block.type === "requestCard")?.request.status, "ready");

  const submitted = await ask(citizen, cid, "Déposer le dossier");
  const submittedCase = submitted.find((block) => block.type === "caseCard")?.case;
  assert.ok(submittedCase, JSON.stringify(submitted));
  assert.equal(submittedCase.status, "awaiting_payment");
  assert.match(submittedCase.reference, /^SIM-JUS-/);

  const paid = await ask(citizen, cid, "Payer les frais");
  const paidCase = paid.find((block) => block.type === "caseCard")?.case;
  assert.equal(paidCase?.status, "in_review", JSON.stringify(paid));

  const admin = await officialToken();
  const claim = await fetch(xroad.url + "/v1/cases/" + paidCase.id + "/actions", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + admin,
      "Content-Type": "application/json",
      "X-Official-Subject": JUSTICE_AGENT,
      "Idempotency-Key": identifier("key"),
      traceparent: tp,
    },
    body: JSON.stringify({ action: "claim", note: null }),
  });
  assert.equal(claim.status, 200, await claim.text());
  const approve = await fetch(xroad.url + "/v1/cases/" + paidCase.id + "/actions", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + admin,
      "Content-Type": "application/json",
      "X-Official-Subject": JUSTICE_AGENT,
      "Idempotency-Key": identifier("key"),
      traceparent: tp,
    },
    body: JSON.stringify({ action: "approve", note: null }),
  });
  assert.equal(approve.status, 200, await approve.text());

  await toolingDb.transaction("system", (tx) => tx.query("update requests set next_check_at = now()"));
  await tracker.tick();
  await publisher.tick();
  let updated = false;
  for (let i = 0; i < 40 && !updated; i++) {
    await publisher.tick();
    const events = await request("/v1/conversations/" + cid + "/events", { bearer: citizen });
    updated = (events.value?.items ?? []).some(
      (item) => item.data?.kind === "message.sent" && item.data.message.blocks.some((block) => block.type === "caseCard" && block.case.status === "completed"),
    );
    if (!updated) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(updated, true, "case.updated n'a pas produit de caseCard completed");

  const mine = await request("/v1/cases", { bearer: citizen });
  assert.equal(mine.status, 200, mine.text);
  const found = mine.value.items.find((item) => item.id === paidCase.id);
  assert.equal(found?.status, "completed");
  const issued = found.documents.find((document) => document.kind === "issued");
  assert.ok(issued, JSON.stringify(found.documents));
  const document = await request("/v1/cases/" + found.id + "/documents/" + issued.id, { bearer: citizen, raw: true });
  assert.equal(document.status, 200, document.text.slice(0, 200));
  assert.match(document.headers.get("content-type") ?? "", /pdf|octet-stream/);
  assert.ok(document.buffer.length > 0);
});
