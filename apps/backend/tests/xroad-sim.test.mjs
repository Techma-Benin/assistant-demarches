import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { createBackend } from "../dist/apps/backend/src/app.js";
import { database, migrate } from "../dist/apps/backend/src/database.js";
import { Conversations } from "../dist/apps/backend/src/conversations.js";
import { Identities } from "../dist/apps/backend/src/identity.js";
import { Files } from "../dist/apps/backend/src/files.js";
import { LocalStorage } from "../dist/apps/backend/src/storage.js";
import { identifier } from "../dist/apps/backend/src/domain.js";
import { isolatedDatabase } from "./helpers.mjs";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const simServer = fileURLToPath(new URL("../../xroad-sim/dist/src/server.js", import.meta.url));
const catalogueFile = fileURLToPath(new URL("../../../content/service-public/catalogue.json", import.meta.url));
if (!existsSync(simServer)) {
  execFileSync("pnpm", ["--filter", "@techma/xroad-sim", "build"], { cwd: repoRoot, stdio: "inherit" });
}
const { createXroadServer } = await import(new URL("../../xroad-sim/dist/src/server.js", import.meta.url).href);
const { loadConfig } = await import(new URL("../../xroad-sim/dist/src/config.js", import.meta.url).href);
const { PgDatabase } = await import(new URL("../../xroad-sim/dist/src/database.js", import.meta.url).href);

const sub = (n) => `7f3c2a10-${n}-4000-8000-00000000${n}`;
const JUSTICE_AGENT = sub("0002");
const JUSTICE_ADMIN = sub("0003");
const ANIP_AGENT = sub("0005");
const SUPER_ADMIN = sub("0006");
const CASIER_FIELDS = {
  adresseDomicile: "Cotonou, Cadjèhoun",
  profession: "Comptable",
  nombreEnfantsACharge: 2,
  situationMatrimoniale: "Marié",
};
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
const tp = "00-" + "a".repeat(32) + "-" + "b".repeat(16) + "-01";

test("v2 backend ↔ xroad-sim: home, cases, documents, console officielle", async (t) => {
  const backendPg = await isolatedDatabase();
  const xroadPg = await isolatedDatabase();
  const pool = database(backendPg.connection);
  const simDb = new PgDatabase(xroadPg.connection);
  const directory = mkdtempSync(join(tmpdir(), "techma-xroad-files-"));
  t.after(async () => {
    await pool.end();
    await backendPg.close();
    rmSync(directory, { recursive: true, force: true });
  });
  await migrate(pool);

  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const kid = "xroad-sim-it";
  const jwk = { ...(await exportJWK(publicKey)), kid, alg: "RS256", use: "sig" };
  let keycloakCreates = 0;
  const oidc = http.createServer((req, res) => {
    if (req.url === "/realms/techma/protocol/openid-connect/certs") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ keys: [jwk] }));
      return;
    }
    if (req.method === "POST" && req.url === "/admin/realms/techma/users") {
      keycloakCreates += 1;
      const subject = "kc-user-" + keycloakCreates;
      res.writeHead(201, { location: "http://127.0.0.1/admin/realms/techma/users/" + subject });
      res.end();
      return;
    }
    if (req.url?.startsWith("/admin/realms/techma/users/")) {
      res.writeHead(204);
      res.end();
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((resolve) => oidc.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => { oidc.closeAllConnections(); oidc.close(resolve); }));
  const issuer = "http://127.0.0.1:" + oidc.address().port + "/realms/techma";

  const running = await createXroadServer(
    loadConfig({
      XROAD_PORT: "0",
      OIDC_ISSUER: issuer,
      DATABASE_URL: xroadPg.connection,
      CATALOGUE_FILE: catalogueFile,
    }),
    simDb,
  ).listen();
  t.after(async () => {
    await running.close();
    await simDb.close();
    await xroadPg.close();
  });

  const xroadToken = (scope) =>
    new SignJWT({ azp: "backend", scope })
      .setProtectedHeader({ alg: "RS256", kid })
      .setIssuer(issuer)
      .setAudience("techma-xroad")
      .setIssuedAt()
      .setExpirationTime("10m")
      .sign(privateKey);
  const auth = {
    issuer,
    audience: "techma-backend",
    key: createLocalJWKSet({ keys: [jwk] }),
  };
  const userToken = (subject, claims = {}) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: "RS256", kid })
      .setIssuer(issuer)
      .setAudience("techma-backend")
      .setSubject(subject)
      .setIssuedAt()
      .setExpirationTime("10m")
      .sign(privateKey);
  const citizen = await userToken("aminata.usager", { scope: "citizen" });
  const otherCitizen = await userToken("other.usager", { scope: "citizen" });
  const justiceAgent = await userToken(JUSTICE_AGENT, { realm_access: { roles: ["official"] } });
  const justiceAdmin = await userToken(JUSTICE_ADMIN, { realm_access: { roles: ["official"] } });
  const anipAgent = await userToken(ANIP_AGENT, { realm_access: { roles: ["official"] } });
  const superAdmin = await userToken(SUPER_ADMIN, { realm_access: { roles: ["official"] } });

  const runtime = {
    pool,
    auth,
    identities: new Identities(pool),
    conversations: new Conversations(pool),
    files: new Files(pool, new LocalStorage(directory)),
    publicUrl: "http://127.0.0.1:4010",
    xroadUrl: running.url + "/",
    serviceTokens: {
      get: (scope) => (scope === "keycloak-admin" ? xroadToken("xroad:administer") : xroadToken(scope)),
    },
  };
  const app = await createBackend({ pool, auth, allowedMcpUrls: new Set(), runtime });
  t.after(() => app.close());
  await app.listen(0, "127.0.0.1");
  const base = await app.getUrl();

  const request = async (path, { method = "GET", body, bearer, headers = {}, key } = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: {
        ...(bearer ? { Authorization: "Bearer " + bearer } : {}),
        traceparent: tp,
        ...(key === false ? {} : { "Idempotency-Key": key ?? identifier("key").slice(0, 32) }),
        ...(body !== undefined && !Buffer.isBuffer(body) ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body),
    });
    const buffer = Buffer.from(await res.arrayBuffer());
    const type = res.headers.get("content-type") ?? "";
    const value = type.includes("json") ? JSON.parse(buffer.toString("utf8")) : buffer;
    return { status: res.status, value, type, buffer };
  };
  const apply = await xroadToken("xroad:apply");
  const sim = async (method, path, { applicant, official, body, headers = {}, binary = false } = {}) => {
    const res = await fetch(running.url + path, {
      method,
      headers: {
        Authorization: "Bearer " + (official ? await xroadToken("xroad:administer") : apply),
        traceparent: tp,
        ...(applicant ? { "X-Applicant-Ref": applicant } : {}),
        ...(official ? { "X-Official-Subject": official } : {}),
        ...(binary ? { "Content-Type": "application/octet-stream" } : body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(method === "POST" ? { "Idempotency-Key": identifier("key").slice(0, 32) } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : binary ? new Uint8Array(body) : JSON.stringify(body),
    });
    const buffer = Buffer.from(await res.arrayBuffer());
    const type = res.headers.get("content-type") ?? "";
    return { status: res.status, value: type.includes("json") ? JSON.parse(buffer.toString("utf8")) : buffer, type };
  };
  const upload = async (applicant, documentType) => {
    const uploaded = await sim("POST", "/v1/uploads", {
      applicant,
      binary: true,
      body: Buffer.from("%PDF-1.4 piece " + documentType),
      headers: { "X-File-Mime-Type": "application/pdf" },
    });
    assert.equal(uploaded.status, 201, JSON.stringify(uploaded.value));
    return { documentType, uploadId: uploaded.value.id };
  };
  const fileCase = async (applicant, procedureId, fields, documentTypes) => {
    const documents = [];
    for (const documentType of documentTypes) documents.push(await upload(applicant, documentType));
    const created = await sim("POST", "/v1/cases", {
      applicant,
      body: { requestId: identifier("req"), procedureId, channel: "web", fields, documents },
    });
    assert.equal(created.status, 201, JSON.stringify(created.value));
    const paid = await sim("POST", `/v1/cases/${created.value.id}/payment`, {
      applicant,
      body: { method: "mobile_money" },
    });
    assert.equal(paid.status, 200, JSON.stringify(paid.value));
    return paid.value;
  };
  const userRefOf = async (bearer) => {
    const before = new Set((await pool.query("SELECT user_ref FROM backend_identities")).rows.map((row) => row.user_ref));
    const listed = await request("/v1/cases", { bearer });
    assert.equal(listed.status, 200, JSON.stringify(listed.value));
    const after = (await pool.query("SELECT user_ref FROM backend_identities")).rows.map((row) => row.user_ref);
    return after.find((id) => !before.has(id)) ?? after[0];
  };

  const home = await request("/v1/home");
  assert.equal(home.status, 200, JSON.stringify(home.value));
  const connected = new Set(home.value.themes.map((item) => item.administrationId));
  assert.ok(connected.has("justice"));
  assert.ok(connected.has("anip"));
  assert.ok(connected.has("enseignement"));
  const assistedIds = home.value.suggestions.filter((item) => item.assisted).map((item) => item.procedureId);
  for (const id of ["PS00373", "PS00393", "PS00392", "PS00254"]) assert.ok(assistedIds.includes(id), id);

  const ownerRef = await userRefOf(citizen);
  const otherRef = await userRefOf(otherCitizen);
  const completed = await fileCase(ownerRef, "PS00393", {}, ["recepisse-ravip", "ancien-acte-naissance"]);
  assert.equal(completed.status, "completed");
  const issued = completed.documents.find((document) => document.kind === "issued");
  assert.ok(issued, "document délivré par le sim");
  const pendingA = await fileCase(ownerRef, "PS00373", CASIER_FIELDS, ["extrait-acte-naissance"]);
  const pendingB = await fileCase(ownerRef, "PS00373", { ...CASIER_FIELDS, profession: "Juriste" }, ["extrait-acte-naissance"]);
  assert.equal(pendingA.status, "in_review");
  assert.equal(pendingB.status, "in_review");

  const mine = await request("/v1/cases", { bearer: citizen });
  assert.equal(mine.status, 200);
  assert.ok(mine.value.items.some((item) => item.id === completed.id));
  assert.ok(mine.value.items.some((item) => item.id === pendingA.id));
  const page = await request("/v1/cases?limit=1", { bearer: citizen });
  assert.equal(page.value.items.length, 1);
  assert.equal(typeof page.value.nextCursor, "string");
  const detail = await request("/v1/cases/" + completed.id, { bearer: citizen });
  assert.equal(detail.status, 200);
  assert.equal(detail.value.id, completed.id);
  const doc = await request("/v1/cases/" + completed.id + "/documents/" + issued.id, { bearer: citizen });
  assert.equal(doc.status, 200);
  assert.match(doc.type, /application\/pdf/);
  assert.match(doc.buffer.toString("latin1"), /%PDF/);
  assert.equal((await request("/v1/cases/" + completed.id, { bearer: otherCitizen })).status, 404);
  assert.equal((await request("/v1/cases/" + completed.id + "/documents/" + issued.id, { bearer: otherCitizen })).status, 404);
  assert.equal(otherRef.startsWith("usr_"), true);

  const me = await request("/v1/admin/me", { bearer: justiceAgent });
  assert.equal(me.status, 200);
  assert.equal(me.value.official.subject, JUSTICE_AGENT);
  assert.equal(me.value.official.administrationId, "justice");
  assert.deepEqual(me.value.permissions, ["cases:read", "cases:act"]);
  const administrations = await request("/v1/admin/administrations", { bearer: justiceAgent });
  assert.equal(administrations.status, 200);
  assert.ok(administrations.value.items.some((item) => item.id === "justice"));

  const agentOfficials = await request("/v1/admin/officials", { bearer: justiceAgent });
  assert.equal(agentOfficials.status, 200);
  assert.equal(agentOfficials.value.items.length, 1);
  assert.equal(agentOfficials.value.items[0].subject, JUSTICE_AGENT);
  const superOfficials = await request("/v1/admin/officials", { bearer: superAdmin });
  assert.equal(superOfficials.status, 200);
  assert.ok(superOfficials.value.items.length >= 5);
  const createdBefore = keycloakCreates;
  assert.equal(
    (await request("/v1/admin/officials", {
      method: "POST",
      bearer: justiceAgent,
      body: { email: "agent.create@demo.techma.bj", displayName: "X", jobTitle: "Agent", administrationId: "justice", role: "agent" },
    })).status,
    403,
  );
  assert.equal(
    (await request("/v1/admin/officials", {
      method: "POST",
      bearer: justiceAdmin,
      body: { email: "admin.create@demo.techma.bj", displayName: "Y", jobTitle: "Chef", administrationId: "justice", role: "agent" },
    })).status,
    403,
  );
  assert.equal(keycloakCreates, createdBefore);
  const created = await request("/v1/admin/officials", {
    method: "POST",
    bearer: superAdmin,
    key: "create-official-sim-ok01",
    body: { email: "nouveau.agent@demo.techma.bj", displayName: "Nouvel Agent", jobTitle: "Instructeur", administrationId: "justice", role: "agent" },
  });
  assert.equal(created.status, 201, JSON.stringify(created.value));
  assert.equal(typeof created.value.temporaryPassword, "string");
  assert.equal(created.value.official.email, "nouveau.agent@demo.techma.bj");
  assert.equal(keycloakCreates, createdBefore + 1);

  const pending = await request("/v1/admin/cases?view=pending", { bearer: justiceAgent });
  assert.equal(pending.status, 200);
  const pendingIds = pending.value.items.map((item) => item.id);
  assert.ok(pendingIds.includes(pendingA.id));
  assert.ok(pendingIds.includes(pendingB.id));
  assert.equal(pendingIds.includes(completed.id), false);
  const all = await request("/v1/admin/cases?view=all", { bearer: justiceAgent });
  assert.ok(all.value.items.some((item) => item.id === pendingA.id));
  assert.equal(all.value.items.some((item) => item.id === completed.id), false, "agent justice : dossier ANIP hors périmètre");
  const one = await request("/v1/admin/cases/" + pendingA.id, { bearer: justiceAgent });
  assert.equal(one.status, 200);
  assert.equal((await request("/v1/admin/cases/" + completed.id, { bearer: justiceAgent })).status, 404);
  assert.equal((await request("/v1/admin/cases/" + pendingA.id, { bearer: anipAgent })).status, 404);

  const claimed = await request("/v1/admin/cases/" + pendingA.id + "/actions", {
    method: "POST",
    bearer: justiceAgent,
    key: "act-claim-pending-a001",
    body: { action: "claim", note: null },
  });
  assert.equal(claimed.status, 200, JSON.stringify(claimed.value));
  assert.equal(claimed.value.status, "in_review");
  const approved = await request("/v1/admin/cases/" + pendingA.id + "/actions", {
    method: "POST",
    bearer: justiceAgent,
    key: "act-approve-pending-a01",
    body: { action: "approve", note: null },
  });
  assert.equal(approved.status, 200, JSON.stringify(approved.value));
  assert.equal(approved.value.status, "completed");
  const issuedByOfficial = approved.value.documents.find((document) => document.kind === "issued");
  assert.ok(issuedByOfficial);
  const officialDoc = await request(
    "/v1/admin/cases/" + pendingA.id + "/documents/" + issuedByOfficial.id,
    { bearer: justiceAgent },
  );
  assert.equal(officialDoc.status, 200);
  assert.match(officialDoc.type, /application\/pdf/);
  assert.equal(
    (await request("/v1/admin/cases/" + pendingA.id + "/documents/" + issuedByOfficial.id, { bearer: anipAgent })).status,
    404,
  );

  const claimedB = await request("/v1/admin/cases/" + pendingB.id + "/actions", {
    method: "POST",
    bearer: justiceAgent,
    key: "act-claim-pending-b001",
    body: { action: "claim", note: null },
  });
  assert.equal(claimedB.status, 200);
  const asked = await request("/v1/admin/cases/" + pendingB.id + "/actions", {
    method: "POST",
    bearer: justiceAgent,
    key: "act-info-pending-b0001",
    body: { action: "request_information", note: "Merci de fournir un acte lisible." },
  });
  assert.equal(asked.status, 200, JSON.stringify(asked.value));
  assert.equal(asked.value.status, "information_requested");
  const rejected = await request("/v1/admin/cases/" + pendingB.id + "/actions", {
    method: "POST",
    bearer: justiceAgent,
    key: "act-reject-pending-b001",
    body: { action: "reject", note: "Pièce illisible." },
  });
  assert.equal(rejected.status, 200);
  assert.equal(rejected.value.status, "rejected");

  const dashboard = await request("/v1/admin/dashboard", { bearer: justiceAgent });
  assert.equal(dashboard.status, 200);
  assert.equal(dashboard.value.metrics.administrationId, "justice");
  assert.ok(dashboard.value.metrics.received >= 2);
  const activity = await request("/v1/admin/activity", { bearer: justiceAgent });
  assert.equal(activity.status, 200);
  assert.ok(activity.value.items.length > 0);

  const conversationId = identifier("cnv");
  await pool.query("INSERT INTO backend_conversations(id,user_ref,administration_id,body) VALUES($1,$2,'global',$3)", [
    conversationId,
    ownerRef,
    { id: conversationId, channel: "web" },
  ]);
  const unansweredId = identifier("unq");
  await pool.query(
    "INSERT INTO backend_unanswered(id,conversation_id,message_id,administration_id,reason,status) VALUES($1,$2,$3,$4,$5,'open')",
    [unansweredId, conversationId, identifier("msg"), "justice", "no_source"],
  );
  const unanswered = await request("/v1/admin/unanswered", { bearer: justiceAgent });
  assert.equal(unanswered.status, 200);
  assert.equal(unanswered.value.items[0].id, unansweredId);
  const resolved = await request("/v1/admin/unanswered/" + unansweredId + "/resolve", {
    method: "POST",
    bearer: justiceAgent,
  });
  assert.equal(resolved.status, 200);
  assert.equal(resolved.value.status, "resolved");

  const avatar = await request("/v1/admin/me/avatar", {
    method: "PUT",
    bearer: justiceAgent,
    headers: { "X-File-Mime-Type": "image/jpeg", "Content-Type": "application/octet-stream" },
    body: JPEG,
  });
  assert.equal(avatar.status, 200, JSON.stringify(avatar.value));
  assert.match(avatar.value.avatarUrl ?? "", /\/v1\/admin\/avatars\//);
  const photo = await request("/v1/admin/avatars/" + encodeURIComponent(me.value.official.id), { bearer: justiceAgent });
  assert.equal(photo.status, 200);
  assert.equal(photo.type, "image/jpeg");
});
