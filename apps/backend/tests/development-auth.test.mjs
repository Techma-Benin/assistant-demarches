import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import { request as httpRequest } from "node:http";
import { createDevelopmentIdentity, loadDevelopmentIdentity } from "../dist/apps/backend/src/development-auth.js";
import { verifyIdentity } from "../dist/apps/backend/src/auth.js";
import { createBackend } from "../dist/apps/backend/src/app.js";
import { attachDocumentation } from "../dist/apps/backend/src/documentation.js";
import { database, migrate } from "../dist/apps/backend/src/database.js";
import { Identities } from "../dist/apps/backend/src/identity.js";
import { Conversations } from "../dist/apps/backend/src/conversations.js";
import { isolatedDatabase } from "./helpers.mjs";

test("Local Swagger test identity authenticates a real conversation and keeps user/admin separation", async () => {
  const fixture = await createDevelopmentIdentity("demo-administration");
  const dir = mkdtempSync(join(tmpdir(), "techma-dev-auth-test-"));
  const file = join(dir, "identity.json");
  writeFileSync(file, JSON.stringify(fixture), { mode: 0o600 });
  const previous = process.env.NODE_ENV;
  let auth;
  try {
    process.env.NODE_ENV = "production";
    assert.throws(() => loadDevelopmentIdentity(file, "127.0.0.1"));
    process.env.NODE_ENV = "development";
    assert.throws(() => loadDevelopmentIdentity(file, "0.0.0.0"));
    auth = loadDevelopmentIdentity(file, "127.0.0.1").auth;
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous;
    rmSync(dir, { recursive: true, force: true });
  }
  assert.equal((await verifyIdentity(`Bearer ${fixture.tokens.user}`, auth)).sub, "local-development-user");
  const pg = await isolatedDatabase();
  const pool = database(pg.connection);
  let app;
  try {
    await migrate(pool);
    const runtime = { pool, auth, identities: new Identities(pool, "local-test-hmac-secret-at-least-32-characters", "demo-administration"), conversations: new Conversations(pool) };
    app = await createBackend({ pool, auth, allowedMcpUrls: new Set(), runtime, developmentTokens: fixture.tokens });
    await app.listen(0, "127.0.0.1");
    const base = await app.getUrl();
    assert.match(await (await fetch(base + "/docs")).text(), /Tester comme usager/);
    const response = await fetch(base + "/docs/development-auth/user");
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const { token } = await response.json();
    const headers = { "Content-Type": "application/json", traceparent: "00-12345678901234567890123456789012-1234567890123456-01", "Idempotency-Key": "local-dev-create-001", Authorization: `Bearer ${token}` };
    const created = await fetch(base + "/v1/conversations", { method: "POST", headers, body: JSON.stringify({ channel: "web", locale: "fr" }) });
    assert.equal(created.status, 201);
    assert.match((await created.json()).id, /^cnv_/);
    const unauthorized = await fetch(base + "/v1/conversations", { method: "POST", headers: { ...headers, Authorization: "" }, body: JSON.stringify({ channel: "web", locale: "fr" }) });
    assert.equal(unauthorized.status, 401);
    const adminAsUser = await fetch(base + "/v1/conversations", { method: "POST", headers: { ...headers, Authorization: `Bearer ${fixture.tokens.admin}` }, body: JSON.stringify({ channel: "web", locale: "fr" }) });
    assert.equal(adminAsUser.status, 403);
    const models = await fetch(base + "/v1/admin/models", { headers: { ...headers, Authorization: `Bearer ${fixture.tokens.admin}` } });
    assert.equal(models.status, 200);
    const department = await fetch(base + "/v1/admin/departments", { method: "POST", headers: {...headers, Authorization: `Bearer ${fixture.tokens.admin}`, "Idempotency-Key": "local-dev-department-001"}, body: JSON.stringify({id:"justice",name:"Justice — démonstration locale"}) });
    assert.equal(department.status,201);
    const profile = await fetch(base + "/v1/admin/me", { headers: {...headers, Authorization: `Bearer ${fixture.tokens.admin}`} });
    assert.equal(profile.status,200);
    assert.equal((await profile.json()).superAdmin,true);

    const wrongHostStatus = await new Promise((resolve, reject) => {
      const req = httpRequest(base + "/docs/development-auth/user", { headers: { Host: "untrusted.example" } }, res => { res.resume(); resolve(res.statusCode); });
      req.on("error", reject); req.end();
    });
    assert.equal(wrongHostStatus, 403);
  } finally {
    await app?.close();
    await pool.end();
    await pg.close();
  }
});

test("Normal documentation exposes no development authentication route or buttons", async () => {
  const app = express();
  attachDocumentation(app);
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    assert.equal((await fetch(base + "/docs/development-auth/user")).status, 404);
    assert.doesNotMatch(await (await fetch(base + "/docs")).text(), /Tester comme usager/);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
