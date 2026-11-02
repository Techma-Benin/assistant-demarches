import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { createBackend } from "../dist/apps/backend/src/app.js";
import { database, migrate } from "../dist/apps/backend/src/database.js";
import { Conversations } from "../dist/apps/backend/src/conversations.js";
import { Identities } from "../dist/apps/backend/src/identity.js";
import { Files } from "../dist/apps/backend/src/files.js";
import { LocalStorage } from "../dist/apps/backend/src/storage.js";
import { identifier } from "../dist/apps/backend/src/domain.js";
import { isolatedDatabase } from "./helpers.mjs";

const administration = {
  id: "justice",
  name: "Justice",
  shortName: "JUS",
  themes: ["justice"],
  connection: { status: "connected", since: "2026-01-01T00:00:00.000Z" },
};
const officialRecord = (subject, role) => ({
  id: role === "admin" ? "off_01JC0000000000000000000002" : "off_01JC0000000000000000000001",
  subject,
  email: subject === "official-admin" ? "admin@b.bj" : "a@b.bj",
  displayName: role === "admin" ? "Administrateur" : "Agent",
  jobTitle: role === "admin" ? "Chef de service" : "Agent",
  administrationId: "justice",
  role,
  avatarUrl: null,
  active: true,
});
const meOf = (subject) => {
  const role = subject === "official-admin" ? "admin" : "agent";
  return {
    official: officialRecord(subject, role),
    administration,
    permissions:
      role === "admin"
        ? ["cases:read", "cases:act", "officials:read", "officials:manage"]
        : ["cases:read", "cases:act"],
  };
};
const metrics = {
  administrationId: "justice",
  period: { from: "2026-01-01T00:00:00.000Z", to: "2026-12-31T23:59:59.000Z" },
  received: 0,
  pending: 0,
  informationRequested: 0,
  completed: 0,
  completedByAssistant: 0,
  rejected: 0,
  medianProcessingHours: null,
  byChannel: [],
  topProcedures: [],
};
const caseId = "cas_01JC0000000000000000000001";
const documentId = "doc_01JC0000000000000000000001";
const foreignCaseId = "cas_01JC0000000000000000000099";
const foreignDocumentId = "doc_01JC0000000000000000000099";

test("v2 admin API: auth order, Keycloak compensation, 401/403/nominal/404", async (t) => {
  const pg = await isolatedDatabase();
  const pool = database(pg.connection);
  const directory = mkdtempSync(join(tmpdir(), "techma-admin-files-"));
  t.after(async () => {
    await pool.end();
    await pg.close();
    rmSync(directory, { recursive: true, force: true });
  });
  await migrate(pool);
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const kid = "admin-v2";
  let keycloakCreates = 0;
  const keycloakDisabled = [];
  const keycloak = http.createServer(async (req, res) => {
    if (req.method === "POST" && req.url === "/admin/realms/techma/users") {
      keycloakCreates += 1;
      const subject = "kc-user-" + keycloakCreates;
      res.writeHead(201, { location: "http://127.0.0.1/admin/realms/techma/users/" + subject });
      res.end();
      return;
    }
    if (req.url?.startsWith("/admin/realms/techma/users/")) {
      keycloakDisabled.push(req.url.split("/").at(-1));
      res.writeHead(204);
      res.end();
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((resolve) => keycloak.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => { keycloak.closeAllConnections(); keycloak.close(resolve); }));
  const issuer = "http://127.0.0.1:" + keycloak.address().port;
  const auth = { issuer, audience: "techma-backend", key: createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid, alg: "RS256" }] }) };
  const token = (subject, claims = {}) =>
    new SignJWT(claims).setProtectedHeader({ alg: "RS256", kid }).setIssuer(issuer).setAudience(auth.audience).setSubject(subject).setIssuedAt().setExpirationTime("5m").sign(privateKey);
  const official = await token("official-1", { realm_access: { roles: ["official"] } });
  const adminOfficial = await token("official-admin", { realm_access: { roles: ["official"] } });
  const citizen = await token("citizen-1", { scope: "citizen" });
  const operator = await token("operator-1", { realm_access: { roles: ["operator"] }, scope: "admin:read" });
  let failOfficialCreate = false;
  let keycloakScope = "";
  const xroad = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks);
    const json = () => {
      res.writeHead(200, { "content-type": "application/json" });
    };
    const problem = (status, code) => {
      res.writeHead(status, { "content-type": "application/problem+json" });
      res.end(JSON.stringify({ type: "about:blank", title: code, status, code, detail: code, traceId: "a".repeat(32) }));
    };
    const subject = req.headers["x-official-subject"];
    if (req.url === "/v1/officials/me" && req.method === "GET") {
      json();
      res.end(JSON.stringify(meOf(subject)));
      return;
    }
    if (req.url === "/v1/officials/me" && req.method === "PUT") {
      json();
      res.end(JSON.stringify({ ...officialRecord(subject, subject === "official-admin" ? "admin" : "agent"), ...JSON.parse(raw.toString() || "{}") }));
      return;
    }
    if (req.url === "/v1/officials/me/avatar") {
      json();
      res.end(JSON.stringify({ ...officialRecord(subject, "agent"), avatarUrl: JSON.parse(raw.toString()).avatarUrl }));
      return;
    }
    if (req.url?.startsWith("/v1/administrations")) {
      json();
      res.end(JSON.stringify({ items: [administration] }));
      return;
    }
    if (req.method === "POST" && req.url === "/v1/officials") {
      if (failOfficialCreate) return problem(409, "CONFLICT");
      const body = JSON.parse(raw.toString());
      res.writeHead(201, { "content-type": "application/json" });
      res.end(JSON.stringify({ ...officialRecord(body.subject, body.role), email: body.email, displayName: body.displayName, jobTitle: body.jobTitle, id: "off_01JC0000000000000000000003" }));
      return;
    }
    if (req.url === "/v1/officials") {
      json();
      res.end(JSON.stringify({ items: [], nextCursor: null }));
      return;
    }
    if (req.method === "PUT" && req.url?.startsWith("/v1/officials/")) {
      json();
      res.end(JSON.stringify(officialRecord(subject, "agent")));
      return;
    }
    if (req.url?.includes("/documents/" + foreignDocumentId) || req.url?.startsWith("/v1/cases/" + foreignCaseId)) {
      return problem(404, "NOT_FOUND");
    }
    if (req.url?.includes("/documents/")) {
      res.writeHead(200, { "content-type": "application/pdf" });
      res.end("%PDF-1.4 synthetic");
      return;
    }
    if (req.method === "POST" && req.url?.includes("/actions")) {
      json();
      res.end(JSON.stringify({
        id: caseId,
        reference: "SIM-JUS-2026-000001",
        simulated: true,
        procedureId: "PS00373",
        title: "Casier",
        administrationId: "justice",
        applicantRef: "usr_01JC0000000000000000000001",
        requestId: "req_01JC0000000000000000000001",
        channel: "web",
        status: "in_review",
        fields: {},
        documents: [],
        payment: { amountFcfa: 0, status: "not_required", reference: null, paidAt: null, simulated: true },
        steps: [],
        informationRequest: null,
        claimedBy: "off_01JC0000000000000000000001",
        completedBy: null,
        decisionNote: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }));
      return;
    }
    if (req.url?.startsWith("/v1/cases/") && req.url !== "/v1/cases/" + caseId && !req.url.startsWith("/v1/cases/" + caseId + "/")) {
      return problem(404, "NOT_FOUND");
    }
    if (req.url?.startsWith("/v1/cases")) {
      json();
      res.end(JSON.stringify({ items: [], nextCursor: null }));
      return;
    }
    if (req.url?.startsWith("/v1/metrics")) {
      json();
      res.end(JSON.stringify(metrics));
      return;
    }
    if (req.url?.startsWith("/v1/activity")) {
      json();
      res.end(JSON.stringify({ items: [], nextCursor: null }));
      return;
    }
    problem(404, "NOT_FOUND");
  });
  await new Promise((resolve) => xroad.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => { xroad.closeAllConnections(); xroad.close(resolve); }));
  const runtime = {
    pool,
    auth,
    identities: new Identities(pool),
    conversations: new Conversations(pool),
    files: new Files(pool, new LocalStorage(directory)),
    publicUrl: "http://127.0.0.1:4010",
    xroadUrl: "http://127.0.0.1:" + xroad.address().port + "/",
    serviceTokens: {
      get: async (scope) => {
        if (scope === "keycloak-admin") keycloakScope = scope;
        return "mock-xroad";
      },
    },
  };
  const app = await createBackend({ pool, auth, allowedMcpUrls: new Set(), runtime });
  t.after(() => app.close());
  await app.listen(0, "127.0.0.1");
  const base = await app.getUrl();
  const tp = "00-" + "3".repeat(32) + "-" + "4".repeat(16) + "-01";
  const call = (path, bearer, extra = {}) =>
    fetch(base + path, {
      method: extra.method ?? "GET",
      headers: {
        ...(bearer ? { Authorization: "Bearer " + bearer } : {}),
        traceparent: tp,
        ...(extra.key === false ? {} : { "Idempotency-Key": extra.key ?? "admin-key-abcdefgh" }),
        ...extra.headers,
      },
      body: extra.body,
    });
  const jsonBody = (value) => ({ headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) });
  const routes = [
    { method: "GET", path: "/v1/admin/me" },
    { method: "PUT", path: "/v1/admin/me", ...jsonBody({ displayName: "Nom", jobTitle: "Poste" }) },
    { method: "PUT", path: "/v1/admin/me/avatar", headers: { "X-File-Mime-Type": "image/jpeg", "Content-Type": "application/octet-stream" }, body: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) },
    { method: "GET", path: "/v1/admin/avatars/off_01JC0000000000000000000001" },
    { method: "GET", path: "/v1/admin/administrations" },
    { method: "GET", path: "/v1/admin/officials" },
    { method: "POST", path: "/v1/admin/officials", ...jsonBody({ email: "new.agent@demo.techma.bj", displayName: "Nouvel Agent", jobTitle: "Instructeur", administrationId: "justice", role: "agent" }) },
    { method: "PUT", path: "/v1/admin/officials/off_01JC0000000000000000000001", ...jsonBody({ administrationId: "justice", role: "agent", active: true }) },
    { method: "GET", path: "/v1/admin/cases" },
    { method: "GET", path: "/v1/admin/cases/" + caseId },
    { method: "POST", path: "/v1/admin/cases/" + caseId + "/actions", ...jsonBody({ action: "claim", note: null }) },
    { method: "GET", path: "/v1/admin/cases/" + caseId + "/documents/" + documentId },
    { method: "GET", path: "/v1/admin/dashboard" },
    { method: "GET", path: "/v1/admin/activity" },
    { method: "GET", path: "/v1/admin/unanswered" },
    { method: "POST", path: "/v1/admin/unanswered/unq_01JC0000000000000000000001/resolve" },
  ];
  for (const route of routes) {
    const extra = { method: route.method, headers: route.headers, body: route.body };
    assert.equal((await call(route.path, undefined, extra)).status, 401, route.method + " " + route.path + " sans jeton");
    assert.equal((await call(route.path, citizen, extra)).status, 403, route.method + " " + route.path + " citoyen");
    assert.equal((await call(route.path, operator, extra)).status, 403, route.method + " " + route.path + " opérateur");
  }
  assert.equal((await call("/v1/admin/me", undefined, { method: "PUT", ...jsonBody({}) })).status, 401, "validate après authentification");
  const createdBefore = keycloakCreates;
  const forbiddenCreate = await call("/v1/admin/officials", official, {
    method: "POST",
    ...jsonBody({ email: "orphan@demo.techma.bj", displayName: "Orphelin", jobTitle: "Agent", administrationId: "justice", role: "agent" }),
  });
  assert.equal(forbiddenCreate.status, 403);
  assert.equal(keycloakCreates, createdBefore, "aucun compte Keycloak pour un agent sans officials:manage");

  assert.equal((await call("/v1/admin/me", official)).status, 200);
  assert.equal((await call("/v1/admin/me", official, { method: "PUT", ...jsonBody({ displayName: "Agent Justice", jobTitle: "Instructeur" }) })).status, 200);
  assert.equal((await call("/v1/admin/me/avatar", official, { method: "PUT", headers: { "X-File-Mime-Type": "image/jpeg", "Content-Type": "application/octet-stream" }, body: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) })).status, 200);
  assert.equal((await call("/v1/admin/avatars/off_01JC0000000000000000000001", official)).status, 200);
  assert.equal((await call("/v1/admin/administrations", official)).status, 200);
  assert.equal((await call("/v1/admin/officials", official)).status, 200);
  assert.equal((await call("/v1/admin/cases", official)).status, 200);
  assert.equal((await call("/v1/admin/cases/" + caseId, official)).status, 200);
  assert.equal((await call("/v1/admin/cases/" + caseId + "/actions", official, { method: "POST", ...jsonBody({ action: "claim", note: null }) })).status, 200);
  assert.equal((await call("/v1/admin/cases/" + caseId + "/documents/" + documentId, official)).status, 200);
  assert.equal((await call("/v1/admin/dashboard", official)).status, 200);
  assert.equal((await call("/v1/admin/activity", official)).status, 200);
  assert.equal((await call("/v1/admin/unanswered", official)).status, 200);
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
  assert.equal((await call("/v1/admin/unanswered/" + unansweredId + "/resolve", official, { method: "POST" })).status, 200);
  assert.equal((await call("/v1/admin/officials/off_01JC0000000000000000000001", official, { method: "PUT", ...jsonBody({ administrationId: "justice", role: "agent", active: true }) })).status, 200);

  assert.equal((await call("/v1/admin/cases/" + foreignCaseId, official)).status, 404);
  assert.equal((await call("/v1/admin/cases/" + caseId + "/documents/" + foreignDocumentId, official)).status, 404);

  failOfficialCreate = true;
  const compensated = await call("/v1/admin/officials", adminOfficial, {
    method: "POST",
    key: "create-official-fail-key",
    ...jsonBody({ email: "fail@demo.techma.bj", displayName: "Echec X-Road", jobTitle: "Agent", administrationId: "justice", role: "agent" }),
  });
  assert.equal(compensated.status, 409);
  assert.equal(keycloakDisabled.length > 0, true, "compte Keycloak désactivé si le X-Road refuse");
  failOfficialCreate = false;
  const created = await call("/v1/admin/officials", adminOfficial, {
    method: "POST",
    key: "create-official-ok-key1",
    ...jsonBody({ email: "ok@demo.techma.bj", displayName: "Agent Ok", jobTitle: "Instructeur", administrationId: "justice", role: "agent" }),
  });
  assert.equal(created.status, 201, await created.clone().text());
  const createdBody = await created.json();
  assert.equal(typeof createdBody.temporaryPassword, "string");
  assert.equal(keycloakScope, "keycloak-admin");

  const createdWithoutKey = await call("/v1/admin/officials", adminOfficial, {
    method: "POST",
    key: false,
    ...jsonBody({ email: "nockey@demo.techma.bj", displayName: "Sans Clé", jobTitle: "Instructeur", administrationId: "justice", role: "agent" }),
  });
  assert.equal(createdWithoutKey.status, 201, await createdWithoutKey.clone().text());
  assert.equal(
    (await call("/v1/admin/officials/off_01JC0000000000000000000001", official, {
      method: "PUT",
      key: false,
      ...jsonBody({ administrationId: "justice", role: "agent", active: true }),
    })).status,
    200,
  );
  assert.equal(
    (await call("/v1/admin/officials", adminOfficial, {
      method: "POST",
      key: "short",
      ...jsonBody({ email: "badkey@demo.techma.bj", displayName: "Bad", jobTitle: "Agent", administrationId: "justice", role: "agent" }),
    })).status,
    400,
  );
  const actionWithoutKey = await call("/v1/admin/cases/" + caseId + "/actions", official, {
    method: "POST",
    key: false,
    ...jsonBody({ action: "claim", note: null }),
  });
  assert.equal(actionWithoutKey.status, 400);
  const actionProblem = await actionWithoutKey.json();
  assert.match(actionProblem.detail ?? "", /Idempotency-Key/);
});
