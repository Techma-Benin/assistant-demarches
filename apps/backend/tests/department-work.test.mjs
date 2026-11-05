import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { readFileSync } from "node:fs";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { createBackend } from "../dist/apps/backend/src/app.js";
import { database, migrate } from "../dist/apps/backend/src/database.js";
import { Conversations } from "../dist/apps/backend/src/conversations.js";
import { Identities } from "../dist/apps/backend/src/identity.js";
import { isolatedDatabase } from "./helpers.mjs";
import { identifier } from "../dist/apps/backend/src/domain.js";

const examples = JSON.parse(readFileSync(new URL("../../../contracts/v2/examples.json", import.meta.url)));

test("v2 admin case actions and unanswered", async (t) => {
  const pg = await isolatedDatabase();
  const pool = database(pg.connection);
  t.after(async () => {
    await pool.end();
    await pg.close();
  });
  await migrate(pool);
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const kid = "work-v2";
  const issuer = "https://identity.example.test/work";
  const auth = { issuer, audience: "techma-backend", key: createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid, alg: "RS256" }] }) };
  const official = await new SignJWT({ realm_access: { roles: ["official"] } })
    .setProtectedHeader({ alg: "RS256", kid })
    .setIssuer(issuer)
    .setAudience(auth.audience)
    .setSubject("official-work")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
  const found = { ...examples.schemas.Case };
  const xroad = http.createServer(async (req, res) => {
    if (req.method === "POST" && req.url?.includes("/actions")) {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString());
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ...found, claimedBy: body.action === "claim" ? "off_01JC0000000000000000000001" : found.claimedBy }));
      return;
    }
    if (req.url?.startsWith("/v1/cases/") && !req.url.includes("/actions")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(found));
      return;
    }
    if (req.url?.startsWith("/v1/metrics")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ administrationId: "justice", casesTotal: 1, casesPending: 1, casesCompleted: 0, casesCompletedByAssistant: 0, casesRejected: 0, medianProcessingHours: null, topProcedures: [] }));
      return;
    }
    res.writeHead(404);
    res.end("{}");
  });
  await new Promise((resolve) => xroad.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => { xroad.closeAllConnections(); xroad.close(resolve); }));
  const runtime = {
    pool,
    auth,
    identities: new Identities(pool),
    conversations: new Conversations(pool),
    xroadUrl: "http://127.0.0.1:" + xroad.address().port + "/",
    serviceTokens: { get: async () => "mock-xroad" },
  };
  const app = await createBackend({ pool, auth, allowedMcpUrls: new Set(), runtime });
  t.after(() => app.close());
  await app.listen(0, "127.0.0.1");
  const base = await app.getUrl();
  const tp = "00-" + "7".repeat(32) + "-" + "8".repeat(16) + "-01";
  const act = await fetch(base + "/v1/admin/cases/" + found.id + "/actions", {
    method: "POST",
    headers: { Authorization: "Bearer " + official, traceparent: tp, "Idempotency-Key": "case-action-key-1", "Content-Type": "application/json" },
    body: JSON.stringify({ action: "claim", note: null }),
  });
  assert.equal(act.status, 200, await act.clone().text());
  const unansweredId = identifier("unq");
  const conversationId = identifier("cnv");
  await pool.query(
    "INSERT INTO backend_conversations(id,user_ref,administration_id,body) VALUES($1,$2,'global',$3)",
    [conversationId, identifier("usr"), { id: conversationId, channel: "web" }],
  );
  await pool.query(
    "INSERT INTO backend_unanswered(id,conversation_id,message_id,administration_id,reason,status) VALUES($1,$2,$3,$4,$5,'open')",
    [unansweredId, conversationId, identifier("msg"), "justice", "no_source"],
  );
  const listed = await fetch(base + "/v1/admin/unanswered", { headers: { Authorization: "Bearer " + official, traceparent: tp } });
  assert.equal(listed.status, 200);
  const page = await listed.json();
  assert.equal(page.items[0].id, unansweredId);
  const ids = async (status) => {
    const res = await fetch(base + "/v1/admin/unanswered?status=" + status, { headers: { Authorization: "Bearer " + official, traceparent: tp } });
    assert.equal(res.status, 200, await res.clone().text());
    return (await res.json()).items.map((item) => item.id);
  };
  assert.deepEqual(await ids("open"), [unansweredId]);
  assert.deepEqual(await ids("resolved"), []);
  const resolved = await fetch(base + "/v1/admin/unanswered/" + unansweredId + "/resolve", {
    method: "POST",
    headers: { Authorization: "Bearer " + official, traceparent: tp, "Idempotency-Key": "resolve-unanswered-1" },
  });
  assert.equal(resolved.status, 200, await resolved.clone().text());
  assert.equal((await resolved.json()).status, "resolved");
  assert.deepEqual(await ids("open"), []);
  assert.deepEqual(await ids("resolved"), [unansweredId]);
});
