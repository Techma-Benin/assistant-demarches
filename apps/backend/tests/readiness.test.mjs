import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { generateKeyPair, exportJWK, createLocalJWKSet, SignJWT } from "jose";
import { isolatedDatabase } from "./helpers.mjs";
import { database, migrate, provision } from "../dist/apps/backend/src/database.js";
import { createBackend } from "../dist/apps/backend/src/app.js";
import {
  probeReadiness,
  resetReadinessProbeCache,
} from "../dist/apps/backend/src/readiness.js";

test("GET /health/ready reports components without secrets and is 503 until a model is active", async (t) => {
  const pg = await isolatedDatabase();
  const pool = database(pg.connection);
  t.after(async () => {
    await pool.end();
    await pg.close();
  });
  await migrate(pool);
  const upstream = http.createServer((_req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ status: "ok", keys: [{ kid: "test" }] }));
  });
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => upstream.close(resolve)));
  const port = upstream.address().port;
  const base = `http://127.0.0.1:${port}`;
  const { publicKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "test-key", alg: "RS256" };
  const app = await createBackend({
    pool,
    auth: {
      issuer: "https://identity.example.test/realm",
      audience: "techma-backend",
      key: createLocalJWKSet({ keys: [jwk] }),
    },
    allowedMcpUrls: new Set(),
    readiness: {
      pool,
      toolingUrl: base,
      xroadUrl: base,
      oidcJwksUrl: `${base}/certs`,
    },
  });
  await app.listen(0, "127.0.0.1");
  t.after(() => app.close());
  const url = await app.getUrl();
  const missing = await fetch(url + "/health/ready");
  assert.equal(missing.status, 503);
  const body = await missing.json();
  assert.equal(body.status, "degraded");
  assert.equal(body.model.ok, false);
  assert.match(body.model.detail, /MODEL_API_KEY/);
  assert.equal(JSON.stringify(body).includes("secret"), false);
  assert.equal(body.database.ok, true);
  assert.equal(body.tooling.ok, true);
  assert.equal(body.xroad.ok, true);
  assert.equal(body.oidc.ok, true);
  await provision(pool, "global", "models", {
    id: "ready",
    label: "Prêt",
    baseUrl: "http://127.0.0.1:9/v1",
    protocol: "chat-completions",
    model: "synthetic",
    apiKeyRef: "TEST_PROVIDER_KEY",
    temperature: 0,
    active: true,
  });
  const ready = await fetch(url + "/health/ready");
  const report = await ready.json();
  assert.equal(report.model.ok, true);
  assert.match(report.model.detail, /Prêt \/ synthetic/);
  assert.equal(report.status === "ok" || report.mcpTools.ok === false, true);
});

test("model readiness probe classifies a provider 403 without leaking secrets", async (t) => {
  resetReadinessProbeCache();
  t.after(resetReadinessProbeCache);
  const pg = await isolatedDatabase();
  const pool = database(pg.connection);
  t.after(async () => {
    await pool.end();
    await pg.close();
  });
  await migrate(pool);
  const upstream = http.createServer((_req, res) => {
    res.writeHead(403, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        error: { message: "Access denied. Please check your network settings. secret-key-test" },
      }),
    );
  });
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => { upstream.closeAllConnections(); upstream.close(resolve); }));
  const baseUrl = `http://127.0.0.1:${upstream.address().port}/v1`;
  await provision(pool, "global", "models", {
    id: "ready",
    label: "Prêt",
    baseUrl,
    protocol: "chat-completions",
    model: "synthetic",
    apiKeyRef: "PROBE_KEY",
    temperature: 0,
    active: true,
  });
  const report = await probeReadiness({
    pool,
    environment: { MODEL_READINESS_PROBE: "on", PROBE_KEY: "secret-key-test" },
  });
  assert.equal(report.model.ok, false);
  assert.match(report.model.detail, /provider_network_access_denied/);
  assert.equal(JSON.stringify(report).includes("secret-key-test"), false);
  const skipped = await probeReadiness({
    pool,
    environment: { MODEL_READINESS_PROBE: "off", PROBE_KEY: "secret-key-test" },
  });
  assert.equal(skipped.model.ok, true);
});
