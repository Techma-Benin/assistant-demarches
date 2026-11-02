import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { readFileSync } from "node:fs";
import { generateKeyPair, exportJWK, createLocalJWKSet, SignJWT } from "jose";
import { isolatedDatabase } from "./helpers.mjs";
import { database, migrate, provision } from "../dist/apps/backend/src/database.js";
import { createBackend } from "../dist/apps/backend/src/app.js";
import { Conversations, envelope } from "../dist/apps/backend/src/conversations.js";
import { Identities } from "../dist/apps/backend/src/identity.js";
import { Consent, LocalProcedureCatalog } from "../dist/apps/backend/src/consent.js";
import { Agent } from "../dist/apps/backend/src/agent.js";
import { catalog } from "../dist/apps/backend/src/tooling.js";
import { identifier, validate } from "../dist/apps/backend/src/domain.js";

const fixtures = JSON.parse(readFileSync(new URL("../../../contracts/v2/examples.json", import.meta.url)));
const procedure = fixtures.schemas.Procedure;
const tp = "00-" + "9".repeat(32) + "-" + "8".repeat(16) + "-01";
const final = (text, sources = []) => ({ text: JSON.stringify({ blocks: [{ type: "text", text, sources }] }), calls: [] });
const toolCall = (name, args) => ({ text: "", calls: [{ id: "call-1", name, arguments: JSON.stringify(args) }] });

test("v2 journey: guest catalogue, loginRequired, attach, consent, caseCard, cases isolation", async (t) => {
  const pg = await isolatedDatabase();
  const pool = database(pg.connection);
  t.after(async () => {
    await pool.end();
    await pg.close();
  });
  await migrate(pool);
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const kid = "journey";
  const issuer = "https://identity.example.test/journey";
  const auth = { issuer, audience: "techma-backend", key: createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid, alg: "RS256" }] }) };
  const token = (claims = {}) =>
    new SignJWT({ scope: "citizen", ...claims })
      .setProtectedHeader({ alg: "RS256", kid })
      .setSubject(claims.sub ?? "portal-user")
      .setIssuer(issuer)
      .setAudience("techma-backend")
      .setIssuedAt()
      .setExpirationTime("10m")
      .sign(privateKey);
  const writeCalls = [];
  const tooling = {
    async discover() {
      return catalog;
    },
    async call(_url, _auth, name, args, context) {
      if (name === "request.create") writeCalls.push({ name, authenticated: context.authenticated, mandateId: context.mandateId });
      if (name === "procedures.get")
        return { structuredContent: procedure, content: [{ type: "text", text: JSON.stringify(procedure) }] };
      if (name === "procedures.search")
        return { structuredContent: { items: [procedure], nextCursor: null }, content: [{ type: "text", text: "{}" }] };
      if (name === "request.create") {
        const request = { ...fixtures.schemas.Request, id: identifier("req"), conversationId: context.conversationId, procedureId: procedure.id };
        return { structuredContent: { request }, content: [{ type: "text", text: JSON.stringify({ request }) }] };
      }
      return { structuredContent: {}, content: [{ type: "text", text: "{}" }] };
    },
  };
  const conversations = new Conversations(pool);
  const identities = new Identities(pool);
  const control = {
    async grant(body) {
      const challenge = body.challenge;
      return {
        id: identifier("mdt"),
        conversationId: challenge.conversationId,
        userRef: challenge.userRef,
        procedureId: challenge.procedureId,
        scopes: challenge.scopes,
        status: "active",
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      };
    },
    async revoke() {
      throw new Error("unused");
    },
  };
  const signing = { key: privateKey, kid, issuer };
  const consent = new Consent(pool, conversations, control, signing, new LocalProcedureCatalog(pool));
  let ownerRef = "";
  const completedCase = () => ({
    ...fixtures.schemas.Case,
    status: "completed",
    applicantRef: ownerRef,
    completedBy: "administration",
    documents: [
      {
        id: "doc_01JD0000000000000000000002",
        kind: "issued",
        documentType: "casier-b3",
        name: "Extrait B3",
        mimeType: "application/pdf",
        sizeBytes: 1200,
        createdAt: "2026-11-02T10:00:00Z",
      },
    ],
  });
  const xroad = http.createServer(async (req, res) => {
    const applicant = req.headers["x-applicant-ref"];
    if (req.url === "/v1/cases" || req.url?.startsWith("/v1/cases?")) {
      if (applicant !== ownerRef) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ items: [], nextCursor: null }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ items: [completedCase()], nextCursor: null }));
      return;
    }
    if (req.url?.includes("/documents/")) {
      if (applicant !== ownerRef) {
        res.writeHead(404, { "content-type": "application/problem+json" });
        res.end(JSON.stringify({ type: "about:blank", title: "NOT_FOUND", status: 404, code: "NOT_FOUND", detail: "hors périmètre", traceId: "b".repeat(32) }));
        return;
      }
      res.writeHead(200, { "content-type": "application/pdf" });
      res.end("%PDF-1.4 journey");
      return;
    }
    if (req.url?.startsWith("/v1/cases/")) {
      if (applicant !== ownerRef) {
        res.writeHead(404, { "content-type": "application/problem+json" });
        res.end(JSON.stringify({ type: "about:blank", title: "NOT_FOUND", status: 404, code: "NOT_FOUND", detail: "hors périmètre", traceId: "b".repeat(32) }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(completedCase()));
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
    identities,
    conversations,
    consent,
    signing,
    xroadUrl: "http://127.0.0.1:" + xroad.address().port + "/",
    serviceTokens: { get: async () => "mock-xroad" },
  };
  const app = await createBackend({ pool, auth, allowedMcpUrls: new Set(["http://127.0.0.1/mcp"]), runtime });
  t.after(() => app.close());
  await app.listen(0, "127.0.0.1");
  const base = await app.getUrl();
  await provision(pool, "global", "models", {
    id: "main",
    label: "Test",
    baseUrl: "http://127.0.0.1:9/v1",
    protocol: "chat-completions",
    model: "test-model",
    apiKeyRef: "TEST_KEY",
    temperature: 0,
    active: true,
  });
  await pool.query("INSERT INTO backend_configurations (administration_id, resource, resource_id, body) VALUES ('global','procedures',$1,$2)", [procedure.id, procedure]);
  await pool.query(
    "INSERT INTO backend_mcp_servers(administration_id,id,body) VALUES('global','tooling',$1)",
    [JSON.stringify({ id: "tooling", name: "Tooling", url: "http://127.0.0.1/mcp", enabled: true, transport: "streamable-http", auth: { type: "none" }, policy: "techma" })],
  );
  for (const tool of catalog) {
    await pool.query(
      "INSERT INTO backend_mcp_tools(administration_id,server_id,name,definition,available,enabled,requires_mandate) VALUES('global','tooling',$1,$2,true,true,$3)",
      [tool.name, tool, Boolean(tool._meta?.["bj.techma/requiresMandate"])],
    );
  }
  const citizen = await token();
  const other = await token({ sub: "other-citizen" });
  const eventsToken = await token({ azp: "tooling", scope: "events:publish", sub: "tooling-events" });
  const request = async (path, { method = "GET", body, bearer, headers = {} } = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: {
        ...(bearer ? { Authorization: "Bearer " + bearer } : {}),
        traceparent: tp,
        "Idempotency-Key": identifier("key").slice(0, 32),
        ...(body && !Buffer.isBuffer(body) ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      body: body ? (Buffer.isBuffer(body) ? body : JSON.stringify(body)) : undefined,
    });
    const text = await res.text();
    const value = text ? JSON.parse(text) : null;
    return { status: res.status, value, text };
  };
  const lastBlocks = async (cid) =>
    (await pool.query(
      "SELECT body->'data'->'message'->'blocks' AS blocks FROM backend_conversation_events WHERE conversation_id=$1 AND body->'data'->>'kind'='message.sent' ORDER BY seq DESC LIMIT 1",
      [cid],
    )).rows[0]?.blocks ?? [];
  const ask = async (user, cid, text, toolName) => {
    const message = { id: identifier("msg"), content: { type: "text", text }, sentAt: new Date().toISOString() };
    await conversations.accept(user, cid, message, identifier("key"), tp);
    let turn = 0;
    const model = {
      async generate() {
        turn += 1;
        if (turn === 1) return toolCall(toolName, { procedureId: procedure.id });
        return toolName === "procedures.get" ? final("L'extrait B3 coûte 1 900 FCFA.", [procedure.source]) : final("Suite.");
      },
    };
    await new Agent(pool, conversations, model, tooling, consent).process(cid);
  };

  const guestSession = await request("/v1/guest-sessions", { method: "POST" });
  assert.equal(guestSession.status, 201);
  const guestToken = guestSession.value.token;
  const created = await request("/v1/conversations", { method: "POST", body: { locale: "fr" }, bearer: guestToken });
  assert.equal(created.status, 201);
  const cid = created.value.id;
  const guestRef = (await pool.query("SELECT user_ref FROM backend_conversations WHERE id=$1", [cid])).rows[0].user_ref;
  const guest = { userRef: guestRef, channel: "web", authenticated: false, expiresAt: Date.now() + 60000, roles: new Set() };

  await ask(guest, cid, "Quel est le tarif du casier judiciaire ?", "procedures.get");
  const sourced = await lastBlocks(cid);
  assert.equal(sourced[0].type, "text");
  assert.equal(sourced[0].sources[0].procedureId, procedure.id);

  writeCalls.length = 0;
  await ask(guest, cid, "Déposer une demande", "request.create");
  assert.equal(writeCalls.length, 0, "aucun outillage d'écriture pour un invité");
  assert.equal((await lastBlocks(cid)).some((block) => block.type === "loginRequired"), true);

  const attached = await request("/v1/conversations/" + cid + "/attach", { method: "POST", body: { guestToken }, bearer: citizen });
  assert.equal(attached.status, 200, attached.text);
  ownerRef = (await pool.query("SELECT user_ref FROM backend_conversations WHERE id=$1", [cid])).rows[0].user_ref;
  const owner = { userRef: ownerRef, channel: "web", authenticated: true, expiresAt: Date.now() + 60000, roles: new Set(["citizen"]) };

  writeCalls.length = 0;
  await ask(owner, cid, "Créer la demande", "request.create");
  assert.equal(writeCalls.length, 0);
  const consentBlock = (await lastBlocks(cid)).find((block) => block.type === "consent");
  assert.equal(consentBlock?.type, "consent");
  validate("Challenge", consentBlock.challenge);

  const unusedGuest = await request("/v1/guest-sessions", { method: "POST" });
  const guestMandate = await request("/v1/conversations/" + cid + "/mandates", {
    method: "POST",
    body: { challengeId: consentBlock.challenge.id, accepted: true },
    bearer: unusedGuest.value.token,
  });
  assert.equal(guestMandate.status, 401);
  const granted = await request("/v1/conversations/" + cid + "/mandates", {
    method: "POST",
    body: { challengeId: consentBlock.challenge.id, accepted: true },
    bearer: citizen,
  });
  assert.equal(granted.status, 201, granted.text);

  writeCalls.length = 0;
  await ask(owner, cid, "Relancer la demande", "request.create");
  assert.equal(writeCalls.length, 1);
  assert.ok(writeCalls[0].mandateId);
  assert.equal((await lastBlocks(cid)).some((block) => block.type === "requestCard"), true);

  const caseBody = completedCase();
  const event = envelope({ kind: "case.updated", conversationId: cid, case: caseBody }, tp, "tooling");
  const ingested = await request("/internal/v1/events", { method: "POST", body: event, bearer: eventsToken });
  assert.equal(ingested.status, 202, ingested.text);
  const events = (await request("/v1/conversations/" + cid + "/events", { bearer: citizen })).value.items;
  assert.ok(events.some((item) => item.data.kind === "message.sent" && item.data.message.blocks.some((block) => block.type === "caseCard")));

  const mine = await request("/v1/cases", { bearer: citizen });
  assert.equal(mine.status, 200, mine.text);
  assert.equal(mine.value.items[0].id, caseBody.id);
  const mineOne = await request("/v1/cases/" + caseBody.id, { bearer: citizen });
  assert.equal(mineOne.status, 200);
  const documentId = caseBody.documents[0].id;
  const doc = await fetch(base + "/v1/cases/" + caseBody.id + "/documents/" + documentId, {
    headers: { Authorization: "Bearer " + citizen, traceparent: tp },
  });
  assert.equal(doc.status, 200);
  const otherList = await request("/v1/cases/" + caseBody.id, { bearer: other });
  assert.equal(otherList.status, 404);
  const otherDoc = await fetch(base + "/v1/cases/" + caseBody.id + "/documents/" + documentId, {
    headers: { Authorization: "Bearer " + other, traceparent: tp },
  });
  assert.equal(otherDoc.status, 404);
});
