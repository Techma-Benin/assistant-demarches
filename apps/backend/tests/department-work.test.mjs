import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalJWKSet, exportJWK, generateKeyPair, jwtVerify, SignJWT } from "jose";
import { Pool } from "pg";
import { isolatedDatabase } from "./helpers.mjs";
import { database, migrate } from "../dist/apps/backend/src/database.js";
import { createBackend } from "../dist/apps/backend/src/app.js";
import { Conversations } from "../dist/apps/backend/src/conversations.js";
import { Identities } from "../dist/apps/backend/src/identity.js";
import { Files } from "../dist/apps/backend/src/files.js";
import { LocalStorage } from "../dist/apps/backend/src/storage.js";
import { DepartmentWork } from "../dist/apps/backend/src/department-work.js";
import { HttpDepartmentCommands } from "../dist/apps/backend/src/department-commands.js";
import { fingerprint, identifier, validate } from "../dist/apps/backend/src/domain.js";

const traceparent = "00-" + "5".repeat(32) + "-" + "6".repeat(16) + "-01";

test("department pivot: one citizen, multiple ministries, real HTTP commands and private document delivery", async t => {
  const pg = await isolatedDatabase(), pool = database(pg.connection);
  const directory = mkdtempSync(join(tmpdir(), "techma-department-work-"));
  t.after(async () => { await pool.end(); await pg.close(); rmSync(directory, { recursive: true, force: true }); });
  await migrate(pool);
  const { privateKey, publicKey } = await generateKeyPair("RS256"), kid = "department-work-test";
  const issuer = "https://identity.example.test/pivot", key = createLocalJWKSet({ keys: [{ ...await exportJWK(publicKey), kid, alg: "RS256" }] });
  const auth = { issuer, audience: "techma-backend", key };
  const token = (subject, claims = {}, audience = "techma-backend") => new SignJWT(claims).setProtectedHeader({ alg: "RS256", kid }).setIssuer(issuer).setAudience(audience).setSubject(subject).setIssuedAt().setExpirationTime("10m").sign(privateKey);
  const citizen = await token("citizen"), otherCitizen = await token("other-citizen"), root = await token("root", { scope: "admin:super" });
  const justiceAdmin = await token("justice-agent"), educationAdmin = await token("education-agent");
  const publisher = await token("tooling-events", { azp: "tooling-events", scope: "events:publish" });
  const documentService = await token("tooling-documents", { azp: "tooling-documents", scope: "documents:transfer" });
  const commandToken = await token("backend-admin", { azp: "backend-admin", scope: "requests:admin" }, "techma-tooling");
  const remoteItems = new Map(), remoteIdempotency = new Map(), commandCalls = [];
  let remoteMode = "normal", remoteDelay = 0, remoteMutations = 0;
  const upstream = http.createServer(async (req, res) => {
    try {
      const { payload } = await jwtVerify(req.headers.authorization?.slice(7) ?? "", key, { issuer, audience: "techma-tooling", algorithms: ["RS256"] });
      assert.equal(payload.azp, "backend-admin"); assert.equal(payload.scope, "requests:admin");
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString());
      const match = /^\/internal\/v1\/admin\/requests\/([^/]+)\/actions$/.exec(req.url ?? "");
      if (!match || req.method !== "POST") { res.writeHead(404); res.end("{}"); return; }
      const id = decodeURIComponent(match[1]), current = remoteItems.get(id), idem = req.headers["idempotency-key"];
      commandCalls.push({ id, body, key: idem, traceparent: req.headers.traceparent });
      if (remoteDelay) await new Promise(resolve => setTimeout(resolve, remoteDelay));
      res.setHeader("Content-Type", "application/json");
      if (remoteMode === "unavailable") { res.writeHead(503); res.end("{}"); return; }
      if (remoteMode === "invalid") { res.writeHead(200); res.end('{"status":"completed"}'); return; }
      if (remoteIdempotency.has(idem)) { res.writeHead(200); res.end(JSON.stringify(remoteIdempotency.get(idem))); return; }
      if (!current || current.administrationId !== body.departmentId) { res.writeHead(404); res.end("{}"); return; }
      if (current.revision !== body.revision) { res.writeHead(409); res.end("{}"); return; }
      const updated = { ...current, revision: current.revision + 1, updatedAt: new Date().toISOString() };
      if (body.action === "claim") { updated.status = "processing"; updated.assignedTo = body.actorRef; }
      if (body.action === "request_information") { updated.status = "blocked"; updated.blocking = { code: "MISSING_DOCUMENT", detail: body.reason, at: updated.updatedAt }; }
      if (body.action === "resume") { updated.status = "processing"; delete updated.blocking; }
      if (body.action === "approve") { updated.status = "completed"; updated.completedAt = updated.updatedAt; updated.completedBy = "human"; delete updated.blocking; }
      if (body.action === "reject") { updated.status = "rejected"; delete updated.blocking; }
      validate("DepartmentRequest", updated);
      if (remoteMode === "wrong-owner") updated.userRef = identifier("usr");
      if (remoteMode === "wrong-department") updated.administrationId = "education";
      if (remoteMode === "normal" || remoteMode === "response-lost") {
        remoteItems.set(id, updated); remoteIdempotency.set(idem, updated); remoteMutations++;
      }
      if (remoteMode === "response-lost") { remoteMode = "normal"; res.destroy(); return; }
      res.writeHead(200); res.end(JSON.stringify(updated));
    } catch (error) { res.writeHead(500, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: error.message })); }
  });
  await new Promise(resolve => upstream.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => { upstream.closeAllConnections(); upstream.close(resolve); }));
  const remoteUrl = "http://127.0.0.1:" + upstream.address().port;
  const files = new Files(pool, new LocalStorage(directory));
  const runtime = { pool, auth, identities: new Identities(pool, "department-pivot-test-identity-secret-32", "justice"), conversations: new Conversations(pool), files, departmentWork: new DepartmentWork(pool) };
  const options = { pool, auth, runtime, allowedMcpUrls: new Set(), departmentCommands: new HttpDepartmentCommands(remoteUrl, async () => commandToken) };
  const app = await createBackend(options);
  t.after(() => app.close()); await app.listen(0, "127.0.0.1");
  const base = await app.getUrl();
  async function request(path, options = {}) {
    const { method = "GET", body, bearer = citizen, idempotency = randomUUID(), headers = {}, baseUrl = base, signal } = options;
    const binary = Buffer.isBuffer(body);
    const response = await fetch(baseUrl + path, { method, signal, headers: { ...(bearer ? { Authorization: "Bearer " + bearer } : {}), traceparent, "Idempotency-Key": idempotency, ...(body !== undefined ? { "Content-Type": binary ? "application/octet-stream" : "application/json" } : {}), ...headers }, ...(body !== undefined ? { body: binary ? body : JSON.stringify(body) } : {}) });
    const isJson = (response.headers.get("content-type") ?? "").includes("json");
    const value = response.status === 204 ? null : isJson ? await response.json() : Buffer.from(await response.arrayBuffer());
    return { status: response.status, value, headers: response.headers };
  }
  const admin = (path, bearer = justiceAdmin, options = {}) => request("/v1/admin" + path, { ...options, bearer });
  for (const [id, name] of [["justice", "Ministère de la Justice"], ["education", "Ministère de l'Enseignement"]]) {
    const result = await admin("/departments", root, { method: "POST", body: { id, name } }); assert.equal(result.status, 201, JSON.stringify(result.value));
  }
  for (const [subject, departmentId] of [["justice-agent", "justice"], ["education-agent", "education"]]) {
    const result = await admin("/users", root, { method: "POST", body: { subject, displayName: subject, memberships: [{ departmentId, role: "admin" }] } }); assert.equal(result.status, 201, JSON.stringify(result.value));
  }
  const created = await request("/v1/conversations", { method: "POST", body: { channel: "web", locale: "fr" } });
  assert.equal(created.status, 201, JSON.stringify(created.value)); const conversation = created.value;
  const otherCreated = await request("/v1/conversations", { method: "POST", bearer: otherCitizen, body: { channel: "web", locale: "fr" } });
  assert.equal(otherCreated.status, 201); const otherConversation = otherCreated.value;
  const pdf = Buffer.from("%PDF-1.4\nSIMULATION DE DOCUMENT ADMINISTRATIF\n%%EOF");
  const upload = await request("/v1/files", { method: "POST", body: pdf, headers: { "X-File-Mime-Type": "application/pdf" } });
  assert.equal(upload.status, 201); const document = { fileId: upload.value.id, name: "casier-simulation.pdf", mimeType: "application/pdf", createdAt: new Date().toISOString(), expiresAt: upload.value.expiresAt, simulation: true };
  const unused = await request("/v1/files", { method: "POST", body: Buffer.from("%PDF private unlisted"), headers: { "X-File-Mime-Type": "application/pdf" } });
  assert.equal(unused.status, 201);
  const createdAt = new Date(Date.now() - 7200000).toISOString(), submittedAt = new Date(Date.now() - 3600000).toISOString();
  const justice = { id: identifier("req"), conversationId: conversation.id, userRef: conversation.userRef, procedureId: "justice-casier", administrationId: "justice", title: "Casier judiciaire", status: "processing", revision: 1, fields: { citizenRecord: "PRIVATE_JUSTICE_RECORD" }, fileIds: [], officialLink: null, createdAt, submittedAt, receiptRef: "SIM-JUSTICE-001", updatedAt: new Date().toISOString(), simulation: true, documents: [document], payment: { status: "paid", amountFcfa: 1000, currency: "XOF", reference: "SIM-PAY-001" } };
  const education = { id: identifier("req"), conversationId: conversation.id, userRef: conversation.userRef, procedureId: "education-attestation", administrationId: "education", title: "Attestation de diplôme", status: "blocked", revision: 1, fields: { diplomaRecord: "PRIVATE_EDUCATION_RECORD" }, fileIds: [], officialLink: null, createdAt, submittedAt, receiptRef: "SIM-EDUCATION-001", updatedAt: new Date().toISOString(), simulation: true, dueAt: new Date(Date.now() - 60000).toISOString(), blocking: { code: "MISSING_CERTIFICATE", detail: "Pièce complémentaire nécessaire", at: new Date().toISOString() } };
  const snapshot = (item, extras = {}) => ({ specversion: "1.0", id: identifier("evt"), source: "urn:techma:tooling", type: "bj.techma.request.snapshot.v1", time: new Date().toISOString(), datacontenttype: "application/json", traceparent, data: { kind: "request.snapshot", request: item, actorRef: "simulated-tooling", action: "request.updated" }, ...extras });
  const publish = (event, overrides = {}) => request("/internal/v1/events", { method: "POST", body: event, bearer: publisher, ...overrides });
  const stream = () => request("/v1/conversations/" + conversation.id + "/events");

  await t.test("C4 accepts authenticated snapshots, rejects forged publishers and enforces the new evidence requirements", async () => {
    const event = snapshot(justice);
    assert.equal((await publish(event, { bearer: citizen })).status, 401);
    assert.equal((await publish(event, { bearer: await token("wrong-service", { azp: "wrong-service", scope: "events:publish" }) })).status, 401);
    assert.equal((await publish(event, { bearer: await token("tooling-events", { azp: "tooling-events", scope: "events:publish" }, "wrong-audience") })).status, 401);
    assert.equal((await publish({})).status, 400);
    assert.equal((await publish(null)).status, 400);
    const source = await publish(snapshot(justice, { source: "urn:techma:backend" })); assert.equal(source.status, 403, JSON.stringify(source.value));
    assert.equal((await publish(snapshot({ ...justice, conversationId: otherConversation.id }))).status, 404);
    for (const invalid of [
      { ...justice, submittedAt: undefined }, { ...justice, receiptRef: undefined },
      { ...education, blocking: undefined }, { ...justice, status: "completed", completedAt: undefined, completedBy: undefined },
      { ...justice, payment: { status: "paid", amountFcfa: 1000, currency: "XOF" } },
    ]) assert.equal((await publish(snapshot(invalid))).status, 400);
    const first = await publish(event, { idempotency: "justice-initial-event" }); assert.equal(first.status, 202, JSON.stringify(first.value));
    assert.equal((await publish(event, { idempotency: "justice-initial-event" })).status, 202);
    assert.equal((await publish(event)).status, 202, "event ID replay is safe even with a different transport key");
    const second = await publish(snapshot(education)); assert.equal(second.status, 202, JSON.stringify(second.value));
    remoteItems.set(justice.id, justice); remoteItems.set(education.id, education);
    assert.equal(Number((await pool.query("SELECT count(*) FROM backend_work_items")).rows[0].count), 2);
    assert.equal(Number((await pool.query("SELECT count(*) FROM backend_department_events WHERE request_id=$1", [justice.id])).rows[0].count), 1);
    const conflicting = { ...event, data: { ...event.data, request: { ...justice, title: "Contradiction" } } };
    assert.equal((await publish(conflicting)).status, 409);
  });
  assert.equal(Number((await pool.query("SELECT count(*) FROM backend_work_items")).rows[0].count), 2, "initial snapshot ingestion must succeed before the remaining integration scenarios");

  await t.test("snapshots cannot take over a legacy owner or diverge through unversioned status events", async () => {
    const legacyId = identifier("req");
    const historical = { id: legacyId, conversationId: otherConversation.id, userRef: otherConversation.userRef, procedureId: "historical-request", status: "processing", fields: { privateRecord: "OTHER_CITIZEN_LEGACY_RECORD" }, fileIds: [], officialLink: null, updatedAt: new Date().toISOString() };
    await pool.query("INSERT INTO backend_requests(id,conversation_id,user_ref,body,last_event_at) VALUES($1,$2,$3,$4,$5)", [legacyId, otherConversation.id, otherConversation.userRef, historical, historical.updatedAt]);
    const collision = await publish(snapshot({ ...justice, id: legacyId }));
    assert.equal(collision.status, 409, JSON.stringify(collision.value));
    const retained = (await pool.query("SELECT conversation_id,user_ref,body FROM backend_requests WHERE id=$1", [legacyId])).rows[0];
    assert.equal(retained.conversation_id, otherConversation.id); assert.equal(retained.user_ref, otherConversation.userRef); assert.deepEqual(retained.body, historical);
    assert.equal((await request("/v1/requests/" + legacyId)).status, 404);
    assert.equal((await request("/v1/requests/" + legacyId, { bearer: otherCitizen })).status, 200);
    assert.equal((await admin("/work-items/" + legacyId)).status, 404);
    const legacyStatus = { specversion: "1.0", id: identifier("evt"), source: "urn:techma:tooling", type: "bj.techma.request.status_changed.v1", time: new Date().toISOString(), datacontenttype: "application/json", traceparent, data: { kind: "request.status_changed", requestId: justice.id, conversationId: conversation.id, from: "processing", to: "completed", at: new Date().toISOString() } };
    const rejected = await publish(legacyStatus); assert.equal(rejected.status, 409, JSON.stringify(rejected.value));
    assert.equal((await request("/v1/requests/" + justice.id)).value.status, "processing");
    assert.equal((await request("/v1/requests/" + justice.id + "/progress")).value.status, "processing");
    assert.equal((await admin("/work-items/" + justice.id)).value.status, "processing");
  });

  await t.test("a single conversation routes dossiers independently with no cross-ministry detail, audit, KPI or document access", async () => {
    const j = await admin("/work-items"), e = await admin("/work-items", educationAdmin);
    assert.equal(j.status, 200); assert.deepEqual(j.value.items.map(i => i.id), [justice.id]);
    assert.equal(e.status, 200); assert.deepEqual(e.value.items.map(i => i.id), [education.id]);
    assert.equal((await admin("/work-items?departmentId=education")).status, 403);
    assert.equal((await admin("/work-items/" + education.id)).status, 404);
    assert.equal((await admin("/work-items/" + justice.id, educationAdmin)).status, 404);
    assert.equal((await admin("/work-items/" + justice.id)).value.fields.citizenRecord, "PRIVATE_JUSTICE_RECORD");
    assert.equal(JSON.stringify(e.value).includes("PRIVATE_JUSTICE_RECORD"), false);
    assert.ok(!("userRef" in j.value.items[0])); assert.ok(!("conversationId" in j.value.items[0]));
    const publicRequest = await request("/v1/requests/" + justice.id);
    assert.equal(publicRequest.status, 200); assert.deepEqual(publicRequest.value.fields, {}); assert.ok(!("administrationId" in publicRequest.value));
    assert.equal((await request("/v1/requests/" + justice.id, { bearer: otherCitizen })).status, 404);
    const jd = await admin("/dashboard"), ed = await admin("/dashboard", educationAdmin);
    assert.equal(jd.status, 200); assert.equal(jd.value.received, 1); assert.equal(jd.value.pending, 1); assert.equal(jd.value.blocked, 0);
    assert.equal(ed.status, 200); assert.equal(ed.value.received, 1); assert.equal(ed.value.blocked, 1); assert.equal(ed.value.overdue, 1);
    assert.deepEqual(jd.value.mostRequested, [{ title: justice.title, count: 1 }]); assert.deepEqual(ed.value.mostRequested, [{ title: education.title, count: 1 }]);
    assert.deepEqual(jd.value.channels, [{ channel: "web", count: 1 }]);
    const ja = await admin("/activity"), ea = await admin("/activity", educationAdmin);
    assert.ok(ja.value.items.every(i => i.requestId === justice.id)); assert.ok(ea.value.items.every(i => i.requestId === education.id));
    assert.ok(ja.value.items.every(i => i.traceId === "5".repeat(32))); assert.equal(JSON.stringify(ja.value).includes("PRIVATE_JUSTICE_RECORD"), false);
    const doc = await admin("/work-items/" + justice.id + "/documents/" + document.fileId);
    assert.equal(doc.status, 200); assert.deepEqual(doc.value, pdf); assert.equal(doc.headers.get("content-type"), "application/pdf"); assert.match(doc.headers.get("content-disposition"), /casier-simulation\.pdf/);
    assert.equal((await admin("/work-items/" + justice.id + "/documents/" + document.fileId, educationAdmin)).status, 404);
    assert.equal((await admin("/work-items/" + justice.id + "/documents/" + unused.value.id)).status, 404);
    const citizenDoc = await request("/v1/requests/" + justice.id + "/documents/" + document.fileId);
    assert.equal(citizenDoc.status, 200); assert.deepEqual(citizenDoc.value, pdf);
    assert.equal((await request("/v1/requests/" + justice.id + "/documents/" + document.fileId, { bearer: otherCitizen })).status, 404);
    assert.equal((await request("/v1/requests/" + education.id + "/documents/" + document.fileId)).status, 404);
    assert.equal((await admin("/dashboard?departmentId=education")).status, 403);
    assert.equal((await admin("/activity?departmentId=education")).status, 403);
    assert.equal((await admin("/dashboard", root)).status, 400, "global actors select a department explicitly");
    assert.equal((await admin("/dashboard?departmentId=education", root)).value.blocked, 1);
  });

  await t.test("field-only updates persist without polluting the replay stream, and stale or contradictory snapshots cannot overwrite", async () => {
    const before = (await stream()).value.items;
    const updated = { ...justice, revision: 2, updatedAt: new Date().toISOString(), fields: { citizenRecord: "PRIVATE_JUSTICE_RECORD_UPDATED" }, progress: { step: 2, total: 4, label: "Vérification" }, evidence: [{ field: "citizenRecord", source: "registry", reference: "SIM-REGISTRY", confirmed: true }] };
    const result = await publish(snapshot(updated)); assert.equal(result.status, 202, JSON.stringify(result.value));
    justice.revision = updated.revision; justice.updatedAt = updated.updatedAt; justice.fields = updated.fields; justice.progress = updated.progress; justice.evidence = updated.evidence; remoteItems.set(justice.id, { ...justice });
    assert.deepEqual((await stream()).value.items, before, "snapshot fields never become C2 events");
    assert.equal((await admin("/work-items/" + justice.id)).value.progress.step, 2);
    const stale = await publish(snapshot({ ...justice, revision: 1, fields: { citizenRecord: "OLD_RECORD" } })); assert.equal(stale.status, 202);
    assert.equal((await admin("/work-items/" + justice.id)).value.fields.citizenRecord, "PRIVATE_JUSTICE_RECORD_UPDATED");
    const conflict = await publish(snapshot({ ...justice, title: "Same revision contradiction" })); assert.equal(conflict.status, 409);
    const reroute = await publish(snapshot({ ...justice, revision: 3, administrationId: "education" })); assert.equal(reroute.status, 409);
    assert.ok((await admin("/activity")).value.items.some(i => i.outcome === "ignored_stale"));
  });

  await t.test("Tooling transfers issued files with a longer retention period and progress stays owner protected", async () => {
    const path = "/internal/v1/requests/" + justice.id + "/documents";
    const options = { method: "POST", body: pdf, bearer: documentService, idempotency: "issued-document-upload", headers: { "X-User-Ref": conversation.userRef, "X-File-Mime-Type": "application/pdf" } };
    assert.equal((await request(path, { ...options, bearer: publisher })).status, 401);
    assert.equal((await request(path, { ...options, headers: { ...options.headers, "X-User-Ref": otherConversation.userRef } })).status, 404);
    assert.equal((await request(path, { ...options, headers: { ...options.headers, "X-File-Mime-Type": "audio/mpeg" } })).status, 415);
    const issued = await request(path, options);
    assert.equal(issued.status, 201, JSON.stringify(issued.value)); assert.ok(Date.parse(issued.value.expiresAt) - Date.now() >= 29 * 86400000);
    assert.deepEqual((await request(path, options)).value, issued.value);
    assert.equal((await request(path, { ...options, body: Buffer.from("%PDF DIFFERENT") })).status, 409);
    assert.equal((await request("/v1/requests/" + justice.id + "/documents/" + issued.value.id)).status, 404, "unpublished files are not downloadable as issued documents");
    const content = "/internal/v1/files/" + issued.value.id + "/content";
    assert.equal((await request(content, { bearer: publisher, headers: { "X-User-Ref": conversation.userRef } })).status, 401);
    assert.equal((await request(content, { bearer: documentService, headers: { "X-User-Ref": otherConversation.userRef } })).status, 404);
    const bytes = await request(content, { bearer: documentService, headers: { "X-User-Ref": conversation.userRef } });
    assert.equal(bytes.status, 200); assert.deepEqual(bytes.value, pdf);
    const issuedMetadata = { ...document, fileId: issued.value.id, name: "document-delivre.pdf", expiresAt: issued.value.expiresAt };
    const updated = { ...justice, revision: justice.revision + 1, documents: [document, issuedMetadata], updatedAt: new Date().toISOString() };
    assert.equal((await publish(snapshot(updated))).status, 202);
    Object.assign(justice, updated); remoteItems.set(justice.id, { ...justice });
    const progress = await request("/v1/requests/" + justice.id + "/progress");
    assert.equal(progress.status, 200); assert.equal(progress.value.progress.step, 2); assert.equal(progress.value.evidence[0].source, "registry"); assert.equal(progress.value.documents.length, 2);
    assert.ok(!("assignedTo" in progress.value)); assert.ok(!("userRef" in progress.value));
    assert.equal((await request("/v1/requests/" + justice.id + "/progress", { bearer: otherCitizen })).status, 404);
    assert.equal((await request("/v1/requests/" + justice.id + "/documents/" + issued.value.id)).status, 200);
    assert.equal((await admin("/work-items/" + justice.id + "/documents/" + issued.value.id)).status, 200);
  });

  await t.test("commands use the real HTTP adapter, inject trusted actor/routing, and serialize different keys at the same revision", async () => {
    const path = "/work-items/" + justice.id + "/actions", body = { action: "claim", revision: justice.revision };
    const before = commandCalls.length;
    for (const spoof of [{ ...body, actorRef: "forged" }, { ...body, departmentId: "education" }]) assert.equal((await admin(path, justiceAdmin, { method: "POST", body: spoof })).status, 400);
    assert.equal(commandCalls.length, before);
    assert.equal((await admin(path, educationAdmin, { method: "POST", body })).status, 403);
    remoteDelay = 50;
    const claimed = await Promise.all(Array.from({ length: 3 }, () => admin(path, justiceAdmin, { method: "POST", body, idempotency: "claim-exactly-once" })));
    remoteDelay = 0;
    for (const result of claimed) { assert.equal(result.status, 200, JSON.stringify(result.value)); assert.equal(result.value.assignedTo, "justice-agent"); }
    assert.equal(commandCalls.length, before + 1);
    const call = commandCalls.at(-1);
    assert.equal(call.body.actorRef, "justice-agent"); assert.equal(call.body.departmentId, "justice"); assert.equal(call.traceparent, traceparent);
    assert.equal(call.key, fingerprint(["justice-agent", "justice", justice.id, "claim-exactly-once"]));
    assert.equal((await admin(path, justiceAdmin, { method: "POST", body: { ...body, action: "approve" }, idempotency: "claim-exactly-once" })).status, 409);
    assert.equal((await admin(path, justiceAdmin, { method: "POST", body })).status, 409);
    const current = claimed[0].value;
    const callsBeforeRace = commandCalls.length;
    remoteDelay = 50;
    const race = await Promise.all(["race-key-01", "race-key-02"].map(idempotency => admin(path, justiceAdmin, { method: "POST", body: { action: "claim", revision: current.revision }, idempotency })));
    remoteDelay = 0;
    assert.deepEqual(race.map(r => r.status).sort(), [200, 409]);
    assert.equal(commandCalls.length, callsBeforeRace + 1, "a second stale action must never reach Tooling");
    const saved = (await admin("/work-items/" + justice.id)).value;
    justice.revision = saved.revision;
  });

  await t.test("a command completes with a PostgreSQL pool limited to one connection", async () => {
    const serialPool = new Pool({ connectionString: pg.connection, max: 1, connectionTimeoutMillis: 1000, statement_timeout: 5000 });
    let serialApp;
    try {
      const serialRuntime = { ...runtime, pool: serialPool, identities: new Identities(serialPool, "department-pivot-test-identity-secret-32", "justice"), conversations: new Conversations(serialPool), files: new Files(serialPool, new LocalStorage(directory)), departmentWork: new DepartmentWork(serialPool) };
      serialApp = await createBackend({ ...options, pool: serialPool, runtime: serialRuntime });
      await serialApp.listen(0, "127.0.0.1");
      const revision = (await admin("/work-items/" + justice.id)).value.revision;
      const calls = commandCalls.length, mutations = remoteMutations;
      const result = await request("/v1/admin/work-items/" + justice.id + "/actions", { method: "POST", body: { action: "claim", revision }, bearer: justiceAdmin, baseUrl: await serialApp.getUrl(), signal: AbortSignal.timeout(5000) });
      assert.equal(result.status, 200, JSON.stringify(result.value)); assert.equal(result.value.revision, revision + 1);
      assert.equal(commandCalls.length, calls + 1); assert.equal(remoteMutations, mutations + 1);
      justice.revision = result.value.revision;
    } finally {
      try { if (serialApp) await serialApp.close(); } finally { await serialPool.end(); }
    }
  });

  await t.test("a lost command response recovers the original key after a newer snapshot without a second remote mutation", async () => {
    const path = "/work-items/" + justice.id + "/actions";
    const revision = (await admin("/work-items/" + justice.id)).value.revision;
    const body = { action: "claim", revision }, idempotency = "recover-lost-command", mutations = remoteMutations, calls = commandCalls.length;
    remoteMode = "response-lost";
    const lost = await admin(path, justiceAdmin, { method: "POST", body, idempotency });
    assert.equal(lost.status, 503, JSON.stringify(lost.value)); assert.equal(remoteMutations, mutations + 1);
    assert.equal((await admin("/work-items/" + justice.id)).value.revision, revision, "a failed HTTP response cannot fabricate local success");
    const remotelyCommitted = remoteItems.get(justice.id);
    assert.equal(remotelyCommitted.revision, revision + 1);
    const returnedSnapshot = await publish(snapshot(remotelyCommitted)); assert.equal(returnedSnapshot.status, 202, JSON.stringify(returnedSnapshot.value));
    const recovered = await admin(path, justiceAdmin, { method: "POST", body, idempotency });
    assert.equal(recovered.status, 200, JSON.stringify(recovered.value)); assert.equal(recovered.value.revision, revision + 1);
    assert.equal(remoteMutations, mutations + 1, "Tooling replays its original result for the stable command key");
    assert.equal(commandCalls.length, calls + 2, "one initial RPC and one recovery RPC");
    assert.equal((await admin(path, justiceAdmin, { method: "POST", body, idempotency })).status, 200);
    assert.equal(commandCalls.length, calls + 2, "the recovered result then replays locally");
    const newKey = await admin(path, justiceAdmin, { method: "POST", body, idempotency: "new-key-stale-command" });
    assert.equal(newKey.status, 409); assert.equal(commandCalls.length, calls + 2);
    assert.equal((await request("/v1/requests/" + justice.id + "/progress")).value.revision, revision + 1);
    justice.revision = revision + 1;
  });

  await t.test("upstream rejection and missing connectors fail explicitly and do not fabricate state", async () => {
    const path = "/work-items/" + justice.id + "/actions", revision = (await admin("/work-items/" + justice.id)).value.revision;
    for (const mode of ["unavailable", "invalid", "wrong-owner", "wrong-department"]) {
      remoteMode = mode;
      const result = await admin(path, justiceAdmin, { method: "POST", body: { action: "claim", revision } });
      assert.ok([404, 409, 503].includes(result.status), JSON.stringify({ mode, status: result.status, value: result.value }));
      assert.equal((await admin("/work-items/" + justice.id)).value.revision, revision);
    }
    remoteMode = "normal";
    const configured = process.env.TOOLING_ADMIN_URL; delete process.env.TOOLING_ADMIN_URL;
    let isolated;
    try { isolated = await createBackend({ pool, auth, runtime, allowedMcpUrls: new Set() }); }
    finally { if (configured !== undefined) process.env.TOOLING_ADMIN_URL = configured; }
    try {
      await isolated.listen(0, "127.0.0.1");
      const result = await request("/v1/admin" + path, { baseUrl: await isolated.getUrl(), bearer: justiceAdmin, method: "POST", body: { action: "claim", revision } });
      assert.equal(result.status, 503); assert.equal(result.value.code, "UPSTREAM_UNAVAILABLE");
    } finally { await isolated.close(); }
    assert.equal((await admin("/work-items/" + justice.id)).value.revision, revision);
  });

  await t.test("human completion produces one citizen statusCard and accurate isolated KPIs", async () => {
    const path = "/work-items/" + justice.id + "/actions";
    let revision = (await admin("/work-items/" + justice.id)).value.revision;
    const blocked = await admin(path, justiceAdmin, { method: "POST", body: { action: "request_information", revision, reason: "Pièce complémentaire contrôlée" } });
    assert.equal(blocked.status, 200, JSON.stringify(blocked.value)); assert.equal(blocked.value.status, "blocked"); revision = blocked.value.revision;
    const resumed = await admin(path, justiceAdmin, { method: "POST", body: { action: "resume", revision } });
    assert.equal(resumed.status, 200); assert.equal(resumed.value.status, "processing"); revision = resumed.value.revision;
    const before = (await stream()).value.items.filter(e => e.data.kind === "message.sent").length;
    const body = { action: "approve", revision }, approved = await admin(path, justiceAdmin, { method: "POST", body, idempotency: "approve-once" });
    assert.equal(approved.status, 200, JSON.stringify(approved.value)); assert.equal(approved.value.status, "completed"); assert.equal(approved.value.completedBy, "human");
    assert.equal((await admin(path, justiceAdmin, { method: "POST", body, idempotency: "approve-once" })).status, 200);
    const events = (await stream()).value.items;
    assert.equal(events.filter(e => e.data.kind === "message.sent").length, before + 1);
    assert.ok(!events.some(e => e.data.kind === "request.snapshot"));
    assert.ok(!JSON.stringify(events).includes("PRIVATE_JUSTICE_RECORD")); assert.ok(!JSON.stringify(events).includes("PRIVATE_EDUCATION_RECORD"));
    const card = events.filter(e => e.data.kind === "message.sent").at(-1).data.message.blocks[0];
    assert.equal(card.type, "statusCard"); assert.equal(card.request.status, "completed"); assert.deepEqual(card.request.fields, {});
    assert.equal((await admin("/work-items?status=pending")).value.items.length, 0);
    assert.deepEqual((await admin("/work-items?status=completed")).value.items.map(i => i.id), [justice.id]);
    assert.equal((await admin("/work-items", educationAdmin)).value.items[0].status, "blocked");
    const jd = (await admin("/dashboard")).value, ed = (await admin("/dashboard", educationAdmin)).value;
    assert.equal(jd.completed, 1); assert.equal(jd.completedByAi, 0); assert.equal(jd.pending, 0); assert.ok(jd.medianProcessingMs >= 3600000);
    assert.equal(ed.completed, 0); assert.equal(ed.blocked, 1);
    const audit = (await admin("/activity")).value.items;
    assert.ok(audit.some(e => e.action === "admin.approve" && e.actorRef === "justice-agent"));
    assert.ok(audit.every(e => e.requestId === justice.id));
    const automated = { ...education, revision: 2, status: "completed", blocking: undefined, updatedAt: new Date().toISOString(), completedAt: new Date().toISOString(), completedBy: "ai" };
    const aiCompletion = await publish(snapshot(automated)); assert.equal(aiCompletion.status, 202, JSON.stringify(aiCompletion.value));
    const automatedKpis = (await admin("/dashboard", educationAdmin)).value;
    assert.equal(automatedKpis.completed, 1); assert.equal(automatedKpis.completedByAi, 1); assert.equal(automatedKpis.pending, 0);
    assert.equal((await admin("/dashboard")).value.completedByAi, 0);
  });

  await t.test("dashboard normalizes dates, handles prototype property titles and calculates an even median", async () => {
    const dept = await admin("/departments", root, { method: "POST", body: { id: "metrics", name: "Contrôle des indicateurs" } }); assert.equal(dept.status, 201);
    const metricConversation = await request("/v1/conversations", { method: "POST", body: { channel: "web", locale: "fr" } }); assert.equal(metricConversation.status, 201);
    const submitted = "2026-10-10T10:00:00.000Z";
    for (const duration of [2000, 4000]) {
      const item = { ...justice, id: identifier("req"), conversationId: metricConversation.value.id, administrationId: "metrics", procedureId: "metrics-constructor", title: "constructor", fields: {}, fileIds: [], documents: [], status: "completed", revision: 1, createdAt: "2026-10-10T09:00:00.000Z", submittedAt: submitted, completedAt: new Date(Date.parse(submitted) + duration).toISOString(), completedBy: "human", updatedAt: new Date(Date.parse(submitted) + duration).toISOString(), receiptRef: "SIM-METRIC-" + duration };
      const stored = await publish(snapshot(item)); assert.equal(stored.status, 202, JSON.stringify(stored.value));
    }
    const dashboard = await admin("/dashboard?departmentId=metrics&from=2026-10-01&to=2026-10-31", root);
    assert.equal(dashboard.status, 200, JSON.stringify(dashboard.value)); validate("Dashboard", dashboard.value);
    assert.deepEqual(dashboard.value.period, { from: "2026-10-01T00:00:00.000Z", to: "2026-10-31T00:00:00.000Z" });
    assert.equal(dashboard.value.received, 2); assert.equal(dashboard.value.completed, 2); assert.equal(dashboard.value.medianProcessingMs, 3000);
    assert.deepEqual(dashboard.value.mostRequested, [{ title: "constructor", count: 2 }]); assert.equal(typeof dashboard.value.mostRequested[0].count, "number");
  });

  await t.test("pagination, date filters, unanswered management and file expiration stay department scoped", async () => {
    const draft = { ...education, id: identifier("req"), administrationId: "justice", procedureId: "justice-other", title: "Autre démarche", status: "draft", revision: 1, fields: {}, submittedAt: undefined, receiptRef: undefined, blocking: undefined, dueAt: undefined };
    assert.equal((await publish(snapshot(draft))).status, 202);
    const page = await admin("/work-items?status=all&limit=1"); assert.equal(page.status, 200); assert.equal(page.value.items.length, 1); assert.ok(page.value.nextCursor);
    const next = await admin("/work-items?status=all&limit=1&cursor=" + page.value.nextCursor); assert.equal(next.status, 200); assert.notEqual(next.value.items[0].id, page.value.items[0].id);
    assert.equal((await admin("/work-items?status=all&cursor=" + page.value.nextCursor, educationAdmin)).status, 400);
    assert.equal((await admin("/work-items?status=completed&cursor=" + page.value.nextCursor)).status, 400);
    assert.deepEqual((await admin("/work-items?status=draft")).value.items.map(i => i.id), [draft.id]);
    for (const query of ["limit=0", "limit=101", "limit=abc", "unknown=x", "status=invalid", "cursor=not-json"]) assert.equal((await admin("/work-items?" + query)).status, 400);
    for (const query of ["from=invalid", "from=2030-01-01T00:00:00Z&to=2020-01-01T00:00:00Z", "from=2020-01-01T00:00:00Z&to=2030-01-01T00:00:00Z"]) assert.equal((await admin("/dashboard?" + query)).status, 400);
    const unansweredId = identifier("unq"), educationUnanswered = identifier("unq");
    await pool.query("INSERT INTO backend_unanswered(id,conversation_id,message_id,administration_id,reason) VALUES($1,$2,$3,'justice','no_source'),($4,$2,$5,'education','no_source')", [unansweredId, conversation.id, identifier("msg"), educationUnanswered, identifier("msg")]);
    const questions = await admin("/unanswered"); assert.equal(questions.status, 200); assert.deepEqual(questions.value.items.map(q => q.id), [unansweredId]);
    assert.equal((await admin("/dashboard")).value.unanswered, 1);
    assert.equal((await admin("/unanswered/" + educationUnanswered + "/resolve", justiceAdmin, { method: "POST" })).status, 403);
    const resolved = await admin("/unanswered/" + unansweredId + "/resolve", justiceAdmin, { method: "POST", idempotency: "resolve-question" });
    assert.equal(resolved.status, 200); assert.equal(resolved.value.status, "resolved");
    assert.equal((await admin("/unanswered/" + unansweredId + "/resolve", justiceAdmin, { method: "POST", idempotency: "resolve-question" })).status, 200);
    assert.equal((await admin("/dashboard")).value.unanswered, 0); assert.equal((await admin("/dashboard", educationAdmin)).value.unanswered, 1);
    const foreignUpload = await request("/v1/files", { method: "POST", bearer: otherCitizen, body: Buffer.from("%PDF FOREIGN OWNER SECRET"), headers: { "X-File-Mime-Type": "application/pdf" } });
    assert.equal(foreignUpload.status, 201);
    const latest = remoteItems.get(justice.id), foreignDocument = { ...document, fileId: foreignUpload.value.id, expiresAt: foreignUpload.value.expiresAt, name: "foreign.pdf" };
    const forgedDocument = await publish(snapshot({ ...latest, revision: latest.revision + 1, documents: [document, foreignDocument] }));
    assert.equal(forgedDocument.status, 202);
    assert.equal((await admin("/work-items/" + justice.id + "/documents/" + foreignDocument.fileId)).status, 404, "Tooling metadata cannot bypass object ownership");
    assert.equal((await request("/v1/requests/" + justice.id + "/documents/" + foreignDocument.fileId)).status, 404);
    await pool.query("UPDATE backend_files SET expires_at=now()-interval '1 second' WHERE id=$1", [document.fileId]);
    assert.equal((await admin("/work-items/" + justice.id + "/documents/" + document.fileId)).status, 404);
    assert.equal((await request("/v1/requests/" + justice.id + "/documents/" + document.fileId)).status, 404);
  });
});
