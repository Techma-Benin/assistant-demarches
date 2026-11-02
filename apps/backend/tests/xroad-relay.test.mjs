import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { generateKeyPair, exportJWK, createLocalJWKSet } from "jose";
import { isolatedDatabase } from "./helpers.mjs";
import { database, migrate } from "../dist/apps/backend/src/database.js";
import { createBackend } from "../dist/apps/backend/src/app.js";
import { Identities } from "../dist/apps/backend/src/identity.js";
import { Conversations } from "../dist/apps/backend/src/conversations.js";
import { validate } from "../dist/apps/backend/src/domain.js";

const tp = "00-" + "1".repeat(32) + "-" + "2".repeat(16) + "-01";

/** Backend wired to a fake X-Road whose next answer is chosen by the test; GET /v1/home is the probe. */
async function harness(t) {
  const pg = await isolatedDatabase();
  const pool = database(pg.connection);
  await migrate(pool);
  const upstream = { reply: (_req, res) => { res.statusCode = 200; res.end("{}"); } };
  const xroad = http.createServer((req, res) => upstream.reply(req, res));
  await new Promise((resolve) => xroad.listen(0, "127.0.0.1", resolve));
  const { publicKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "k", alg: "RS256" };
  const auth = { issuer: "https://identity.example.test/realm", audience: "techma-backend", key: createLocalJWKSet({ keys: [jwk] }) };
  const runtime = {
    pool, auth,
    identities: new Identities(pool),
    conversations: new Conversations(pool),
    xroadUrl: `http://127.0.0.1:${xroad.address().port}/`,
    serviceTokens: { get: async () => "service-token" },
  };
  const app = await createBackend({ pool, auth, allowedMcpUrls: new Set(), runtime });
  await app.listen(0, "127.0.0.1");
  t.after(async () => {
    await app.close();
    xroad.closeAllConnections();
    await new Promise((resolve) => xroad.close(resolve));
    await pool.end();
    await pg.close();
  });
  const base = await app.getUrl();
  return {
    upstream,
    async home() {
      const res = await fetch(base + "/v1/home", { headers: { traceparent: tp } });
      return { status: res.status, type: res.headers.get("content-type"), retryAfter: res.headers.get("retry-after"), body: await res.json() };
    },
  };
}

const problem = (status, body, headers = {}) => (_req, res) => {
  res.writeHead(status, { "content-type": "application/problem+json", ...headers });
  res.end(JSON.stringify(body));
};

test("X-Road 429 is relayed as RATE_LIMITED with its Retry-After; other unrelayed statuses stay 503", async (t) => {
  const h = await harness(t);
  h.upstream.reply = problem(429, { code: "RATE_LIMITED", detail: "slow down" }, { "Retry-After": "7" });
  const limited = await h.home();
  assert.equal(limited.status, 429);
  assert.match(limited.type, /application\/problem\+json/);
  assert.equal(limited.body.code, "RATE_LIMITED");
  assert.equal(limited.retryAfter, "7");
  assert.equal(limited.body.status, 429);

  h.upstream.reply = problem(429, {});
  const bare = await h.home();
  assert.equal(bare.status, 429);
  assert.equal(bare.body.code, "RATE_LIMITED");
  assert.equal(bare.retryAfter, null, "no Retry-After invented when the upstream sent none");

  h.upstream.reply = problem(429, {}, { "Retry-After": "Wed, 21 Oct 2026 07:28:00 GMT" });
  assert.equal((await h.home()).retryAfter, null, "only a delay in seconds is relayed");

  for (const status of [418, 500, 502, 504]) {
    h.upstream.reply = problem(status, {});
    const other = await h.home();
    assert.equal(other.status, 503, String(status));
    assert.equal(other.body.code, "UPSTREAM_UNAVAILABLE", String(status));
  }
  for (const probe of [limited, bare]) validate("Problem", probe.body);
});
