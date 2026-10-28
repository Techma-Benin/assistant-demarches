import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { startStack, until, pause } from "./local-stack.mjs";
import { identifier } from "../apps/backend/dist/apps/backend/src/domain.js";
import { McpGateway } from "../apps/backend/dist/apps/backend/src/tooling.js";
import { ServiceTokens } from "../apps/backend/dist/apps/backend/src/runtime.js";

test("Backend + worker Redis + Tooling réels, PostgreSQL et JWT vérifiés dans les deux sens", { timeout: 120000 }, async t => {
  const stack = await startStack();
  t.after(() => stack.close());
  const traceparent = "00-" + randomUUID().replaceAll("-", "") + "-" + randomUUID().replaceAll("-", "").slice(0, 16) + "-01";
  async function api(path, { method = "GET", body, token = stack.tokens.user, key = randomUUID(), status = 200, binary = false } = {}) {
    const response = await fetch(stack.backendUrl + path, {
      method, headers: { Authorization: `Bearer ${token}`, traceparent, "Idempotency-Key": key,
        ...(body === undefined ? {} : { "Content-Type": binary ? "application/octet-stream" : "application/json" }),
        ...(binary ? { "X-File-Mime-Type": "application/pdf" } : {}),
      }, body: body === undefined ? undefined : binary ? body : JSON.stringify(body),
    });
    const value = await response.json();
    assert.equal(response.status, status, JSON.stringify(value));
    return value;
  }
  let conversation, mandate, request, file;
  const events = async () => {
    const items = [];
    let cursor;
    while (true) {
      const page = await api(`/v1/conversations/${conversation.id}/events${cursor ? "?cursor=" + cursor : ""}`);
      items.push(...page.items);
      if (page.items.length < 100) return items;
      assert.notEqual(page.nextCursor, cursor);
      cursor = page.nextCursor;
    }
  };
  async function message(text) {
    const previous = (await events()).filter(event => event.data.kind === "message.sent").length;
    const body = { id: identifier("msg"), content: { type: "text", text }, sentAt: new Date().toISOString() };
    const key = randomUUID();
    const accepted = await api(`/v1/conversations/${conversation.id}/messages`, { method: "POST", body, key, status: 202 });
    const reply = await until(async () => {
      stack.assertWorker();
      const sent = (await events()).filter(event => event.data.kind === "message.sent");
      return sent.length > previous && sent.at(-1).data.message;
    }, `réponse du worker à ${text}`);
    return { body, key, accepted, reply };
  }
  const credentials = new ServiceTokens();
  const gateway = new McpGateway(new Set([stack.toolingUrl + "/mcp"]), () => credentials.get("backend-agent", "tools:call", "techma-tooling"));
  const context = () => ({ conversationId: conversation.id, userRef: conversation.userRef, traceparent, ...(mandate ? { mandateId: mandate.id } : {}) });
  const call = (name, args, key = randomUUID(), override = {}) => gateway.call(stack.toolingUrl + "/mcp", "backend-agent", name, args, { ...context(), ...override }, key);

  await t.test("identités séparées, découverte des huit outils et recherche via le worker", async () => {
    await api("/v1/conversations", { method: "POST", body: { channel: "web", locale: "fr" }, token: "invalid", status: 401 });
    await api("/v1/conversations", { method: "POST", body: { channel: "web", locale: "fr" }, token: stack.tokens.admin, status: 403 });
    const servers = await api("/v1/admin/mcp-servers", { token: stack.tokens.admin });
    assert.equal(servers.items.length, 1);
    const discovered = await api(`/v1/admin/mcp-servers/${servers.items[0].id}/discover`, { method: "POST", token: stack.tokens.admin });
    assert.equal(discovered.items.length, 8);
    assert.ok(discovered.items.every(tool => tool.available && tool.enabled));
    conversation = await api("/v1/conversations", { method: "POST", body: { channel: "web", locale: "fr" }, status: 201 });
    await api(`/v1/conversations/${conversation.id}/events`, { token: stack.tokens.other, status: 404 });
    const listed = await gateway.discover(stack.toolingUrl + "/mcp", "backend-agent", context());
    assert.equal(listed.length, 8);
    const { reply } = await message("rechercher");
    assert.equal(reply.blocks[0].sources[0].procedureId, stack.procedure.id);
    assert.ok((await events()).some(event => event.data.kind === "tool.called" && event.data.toolName === "procedures.search" && event.source === "urn:techma:tooling"));
  });

  await t.test("aucune action sans mandat et preuve de consentement vérifiée par le vrai Tooling", async () => {
    const denied = await call("request.create", { procedureId: stack.procedure.id });
    assert.equal(JSON.parse(denied.content[0].text).code, "MANDATE_MISSING");
    const challenge = await api(`/v1/conversations/${conversation.id}/mandate-challenges`, { method: "POST", body: { procedureId: stack.procedure.id, scopes: ["requests:write", "documents:write", "requests:submit"] }, status: 201 });
    const tampered = { ...challenge, id: identifier("chl") };
    const response = await fetch(stack.toolingUrl + "/internal/v1/mandates", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + await credentials.get("backend-mandates", "mandates:grant", "techma-tooling"), traceparent, "Idempotency-Key": randomUUID() },
      body: JSON.stringify({ challenge: tampered, acceptedAt: new Date().toISOString(), evidenceRef: "proof_integration" }),
    });
    assert.equal(response.status, 403, await response.text());
    const body = { challengeId: challenge.id, accepted: true }, key = randomUUID();
    mandate = await api(`/v1/conversations/${conversation.id}/mandates`, { method: "POST", body, key, status: 201 });
    assert.equal(mandate.status, "active");
    assert.deepEqual(await api(`/v1/conversations/${conversation.id}/mandates`, { method: "POST", body, key, status: 201 }), mandate);
    await api(`/v1/conversations/${conversation.id}/mandates`, { method: "POST", body, status: 403 });
  });

  await t.test("création réelle par l’agent, projection C4 et rejeux sans doublon", async () => {
    const sent = await message("creer");
    assert.equal(sent.reply.blocks[0].type, "statusCard");
    request = sent.reply.blocks[0].request;
    assert.equal(request.status, "draft");
    await until(async () => {
      const rows = await stack.pool.query("SELECT body FROM backend_requests WHERE id=$1", [request.id]);
      return rows.rows[0];
    }, "projection request.created");
    assert.equal((await api(`/v1/requests/${request.id}`)).id, request.id);
    await api(`/v1/requests/${request.id}`, { token: stack.tokens.other, status: 404 });
    await api(`/v1/conversations/${conversation.id}/messages`, { method: "POST", body: sent.body, key: sent.key, status: 202 });
    const key = randomUUID();
    const first = await call("request.update", { requestId: request.id, fields: { displayName: "Usager fictif" } }, key);
    assert.ok(!first.isError, JSON.stringify(first));
    const replay = await call("request.update", { requestId: request.id, fields: { displayName: "Usager fictif" } }, key);
    assert.deepEqual(replay.structuredContent, first.structuredContent);
    assert.deepEqual(JSON.parse(replay.content[0].text), JSON.parse(first.content[0].text));
    const conflict = await call("request.update", { requestId: request.id, fields: { displayName: "Autre" } }, key);
    assert.equal(JSON.parse(conflict.content[0].text).code, "IDEMPOTENCY_CONFLICT");
    const rows = await stack.toolingDb.transaction("system", tx => tx.query("SELECT id FROM requests WHERE conversation_id=$1", [conversation.id]));
    assert.equal(rows.length, 1);
  });

  await t.test("pièce disponible immédiatement, remplissage, préparation du lien et remontée du statut", async () => {
    file = await api("/v1/files", { method: "POST", body: Buffer.from("Autre pièce utilisateur sans analyse de contenu"), binary: true, status: 201 });
    assert.equal("scanStatus" in file, false);
    const completed = await message(`completer ${request.id}`);
    assert.equal(completed.reply.blocks[0].request.fields.displayName, "Usager fictif");
    const attached = await message(`joindre ${request.id} ${file.id}`);
    assert.equal(attached.reply.blocks[0].request.status, "ready");
    const submitted = await message(`soumettre ${request.id}`);
    assert.equal(submitted.reply.blocks[0].request.status, "awaiting_user_validation");
    assert.equal(submitted.reply.blocks[0].request.officialLink, stack.procedure.source.url);
    await until(async () => (await api(`/v1/requests/${request.id}`)).status === "awaiting_user_validation", "projection du statut final");
    const verification = await call("documents.verify", { requestId: request.id, fileId: file.id });
    assert.deepEqual(verification.structuredContent, { fileId: file.id, status: "valid", reasons: [] });
  });

  await t.test("reprise du worker, STOP révoque le mandat et interdit les actions", async () => {
    const before = (await events()).filter(event => event.data.kind === "message.sent").length;
    await stack.restartWorker();
    await pause(1200);
    assert.equal((await events()).filter(event => event.data.kind === "message.sent").length, before);
    await message("STOP");
    const denied = await call("request.update", { requestId: request.id, fields: { displayName: "Interdit" } });
    assert.equal(JSON.parse(denied.content[0].text).code, "MANDATE_REVOKED");
    assert.ok((await events()).some(event => event.data.kind === "mandate.revoked"));
    for (const client of ["backend-agent", "backend-mandates", "tooling-resources", "tooling-events"]) assert.ok(stack.tokenRequests.includes(client), `client_credentials absent : ${client}`);
    await until(async () => {
      const rows = await stack.toolingDb.transaction("system", tx => tx.query("SELECT id FROM outbox WHERE published_at IS NULL AND dead_at IS NULL"));
      return rows.length === 0;
    }, "publication complète de l’outbox");
    const dead = await stack.toolingDb.transaction("system", tx => tx.query("SELECT id, last_error FROM outbox WHERE dead_at IS NOT NULL"));
    assert.deepEqual(dead, []);
  });
});

test("Le lanceur interactif nettoie sa session après Ctrl+C sur le groupe de processus", { timeout: 30000, skip: process.platform === "win32" }, async t => {
  const child = spawn(process.execPath, ["--env-file-if-exists=integration/.env", "integration/local-stack.mjs"], {
    cwd: fileURLToPath(new URL("../", import.meta.url)), detached: true,
    env: { ...process.env, INTEGRATION_BACKEND_PORT: "0", INTEGRATION_TOOLING_PORT: "0" }, stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  for (const stream of [child.stdout, child.stderr]) stream.on("data", chunk => { logs += chunk; });
  const exited = new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", (code, signal) => resolve({ code, signal })); });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); });
  await until(() => {
    if (child.exitCode !== null) throw new Error(logs);
    return logs.includes("Ctrl+C supprime");
  }, "démarrage interactif");
  const sample = /Exemple de pièce synthétique : (.+)\/synthetic\.pdf/.exec(logs);
  assert.ok(sample, logs);
  assert.ok(existsSync(sample[1]));
  process.kill(-child.pid, "SIGINT");
  assert.deepEqual(await exited, { code: 0, signal: null }, logs);
  assert.ok(!existsSync(sample[1]), "Les fichiers temporaires doivent être supprimés.");
});
