import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { startStack, until } from "./local-stack.mjs";
import { McpGateway } from "../apps/backend/dist/apps/backend/src/tooling.js";
import { ServiceTokens } from "../apps/backend/dist/apps/backend/src/runtime.js";
import { seedDirectory } from "../apps/backend/dist/apps/backend/src/directory-seed.js";

// Slide 8 « un message, deux bureaux » : vrai Backend, vrai Tooling, X-Road simulé, sans Redis ni modèle.
// Les appels d’outils de l’agent passent par le McpGateway du Backend, comme ceux du worker.
// Casier judiciaire : fiche officielle PS00373 de service-public.bj.
const CASIER = "PS00373";
test("Un casier déposé arrive En attente chez la Justice, invisible pour l’Enseignement, puis se traite depuis la console", { timeout: 120000 }, async t => {
  const stack = await startStack({ worker: false, xroad: true });
  t.after(() => stack.close());
  await seedDirectory(stack.pool, JSON.parse(readFileSync(new URL("../apps/backend/seeds/demo-deux-bureaux.json", import.meta.url))));
  const justice = await stack.sign({}, "justice-agent"), enseignement = await stack.sign({}, "enseignement-agent"), superAdmin = await stack.sign({}, "demo-super-admin");
  const traceparent = "00-" + randomUUID().replaceAll("-", "") + "-" + randomUUID().replaceAll("-", "").slice(0, 16) + "-01";
  async function api(path, { method = "GET", body, token = stack.tokens.user, key = randomUUID(), status = 200, binary = false } = {}) {
    const response = await fetch(stack.backendUrl + path, {
      method, headers: { Authorization: `Bearer ${token}`, traceparent, "Idempotency-Key": key,
        ...(body === undefined ? {} : { "Content-Type": binary ? "application/octet-stream" : "application/json" }),
        ...(binary ? { "X-File-Mime-Type": "application/pdf" } : {}),
      }, body: body === undefined ? undefined : binary ? body : JSON.stringify(body),
    });
    const value = await response.json();
    assert.equal(response.status, status, `${method} ${path} : ${JSON.stringify(value)}`);
    return value;
  }
  const pending = (token, departmentId) => api(`/v1/admin/work-items?departmentId=${departmentId}&status=pending`, { token });
  const completed = (token, departmentId) => api(`/v1/admin/work-items?departmentId=${departmentId}&status=completed`, { token });
  const credentials = new ServiceTokens();
  const gateway = new McpGateway(new Set([stack.toolingUrl + "/mcp"]), () => credentials.get("backend-agent", "tools:call", "techma-tooling"));
  let conversation, mandate, requestId, item;
  const call = async (name, args) => {
    const result = await gateway.call(stack.toolingUrl + "/mcp", "backend-agent", name, args, { conversationId: conversation.id, userRef: conversation.userRef, traceparent, mandateId: mandate.id }, randomUUID());
    assert.ok(!result.isError, `${name} : ${result.content?.[0]?.text}`);
    return result.structuredContent;
  };

  await t.test("annuaire de démo : chaque agent ne voit que son ministère", async () => {
    assert.deepEqual((await api("/v1/admin/me", { token: justice })).memberships.map(m => m.departmentId), ["justice"]);
    assert.deepEqual((await api("/v1/admin/me", { token: enseignement })).memberships.map(m => m.departmentId), ["enseignement"]);
    assert.equal((await pending(justice, "justice")).items.length, 0);
    await api("/v1/admin/work-items?departmentId=justice&status=pending", { token: enseignement, status: 403 });
  });

  await t.test("l’usager consent puis l’agent dépose un casier au X-Road simulé", async () => {
    conversation = await api("/v1/conversations", { method: "POST", body: { channel: "web", locale: "fr" }, status: 201 });
    const challenge = await api(`/v1/conversations/${conversation.id}/mandate-challenges`, { method: "POST", body: { procedureId: CASIER, scopes: ["requests:write", "documents:write", "requests:submit"] }, status: 201 });
    mandate = await api(`/v1/conversations/${conversation.id}/mandates`, { method: "POST", body: { challengeId: challenge.id, accepted: true }, status: 201 });
    requestId = (await call("request.create", { procedureId: CASIER })).id;
    await call("request.update", { requestId, fields: { adresseDomicile: "Cotonou, Cadjèhoun", profession: "Comptable", nombreEnfantsACharge: 2, situationMatrimoniale: "Marié" } });
    const file = await api("/v1/files", { method: "POST", body: stack.syntheticFile, binary: true, status: 201 });
    await call("documents.attach", { requestId, fileId: file.id, documentType: "extrait-acte-naissance" });
    assert.equal((await call("request.submit", { requestId })).status, "awaiting_user_validation");
    await until(async () => (await call("request.status", { requestId })).status === "submitted", "dépôt par le connecteur X-Road");
    assert.equal((await call("request.pay", { requestId })).status, "paid");
  });

  await t.test("slide 8 : Justice En attente (1), Enseignement En attente (0), le super admin voit tout", async () => {
    const queue = await until(async () => {
      const page = await pending(justice, "justice");
      return page.items.some(i => i.id === requestId && i.status === "blocked") && page;
    }, "snapshot du casier payé, à vérifier, dans la file Justice");
    assert.equal(queue.items.length, 1);
    item = queue.items[0];
    assert.equal(item.status, "blocked");
    assert.equal(item.simulation, true);
    assert.match(item.receiptRef, /^SIM-/);
    assert.equal((await pending(enseignement, "enseignement")).items.length, 0);
    await api(`/v1/admin/work-items/${requestId}`, { token: enseignement, status: 404 });
    assert.deepEqual((await pending(superAdmin, "justice")).items.map(i => i.id), [requestId]);
    assert.equal((await pending(superAdmin, "enseignement")).items.length, 0);
    const dashboard = await api("/v1/admin/dashboard?departmentId=justice", { token: justice });
    assert.equal(dashboard.pending, 1);
  });

  await t.test("la console prend en charge et approuve : l’action traverse le Tooling jusqu’au X-Road", async () => {
    const action = (body, token = justice, status = 200) => api(`/v1/admin/work-items/${requestId}/actions`, { method: "POST", body: { revision: item.revision, ...body }, token, status });
    await action({ action: "claim" }, enseignement, 403);
    item = await action({ action: "claim" });
    assert.equal(item.status, "processing");
    item = await action({ action: "approve", reason: "Identité confirmée" });
    assert.equal(item.status, "completed");
    assert.equal(item.completedBy, "human");
    const caseId = (await stack.toolingDb.transaction("system", tx => tx.query("SELECT external_ref FROM requests WHERE id=$1", [requestId])))[0].external_ref;
    assert.equal(stack.xroadStore.getCase({ kind: "applicant", applicantRef: conversation.userRef }, caseId).completedBy, "administration");
    await until(async () => (await completed(justice, "justice")).items.some(i => i.id === requestId), "dossier dans Complété");
    assert.equal((await pending(justice, "justice")).items.length, 0);
    assert.equal((await api(`/v1/requests/${requestId}`)).status, "completed", "l’usager voit la décision");
  });

  await t.test("acte de naissance sécurisé : file ANIP, complété par l’assistant, invisible pour la Justice", async () => {
    const anip = await stack.sign({}, "anip-agent");
    const challenge = await api(`/v1/conversations/${conversation.id}/mandate-challenges`, { method: "POST", body: { procedureId: "PS00393", scopes: ["requests:write", "documents:write", "requests:submit"] }, status: 201 });
    mandate = await api(`/v1/conversations/${conversation.id}/mandates`, { method: "POST", body: { challengeId: challenge.id, accepted: true }, status: 201 });
    const acte = (await call("request.create", { procedureId: "PS00393" })).id;
    for (const documentType of ["recepisse-ravip", "ancien-acte-naissance"]) {
      const file = await api("/v1/files", { method: "POST", body: stack.syntheticFile, binary: true, status: 201 });
      await call("documents.attach", { requestId: acte, fileId: file.id, documentType });
    }
    await call("request.submit", { requestId: acte });
    await until(async () => (await call("request.status", { requestId: acte })).status === "submitted", "dépôt ANIP");
    assert.equal((await call("request.pay", { requestId: acte })).status, "paid");
    await until(async () => (await completed(anip, "anip")).items.some(i => i.id === acte && i.completedBy === "ai"), "acte complété par l’assistant dans la file ANIP");
    await api(`/v1/admin/work-items/${acte}`, { token: justice, status: 404 });
  });

  await t.test("passeport : information seulement, aucun dossier, l’agent reçoit le lien officiel", async () => {
    const challenge = await api(`/v1/conversations/${conversation.id}/mandate-challenges`, { method: "POST", body: { procedureId: "PS00328", scopes: ["requests:write", "documents:write", "requests:submit"] }, status: 201 });
    mandate = await api(`/v1/conversations/${conversation.id}/mandates`, { method: "POST", body: { challengeId: challenge.id, accepted: true }, status: 201 });
    const refused = await gateway.call(stack.toolingUrl + "/mcp", "backend-agent", "request.create", { procedureId: "PS00328" }, { conversationId: conversation.id, userRef: conversation.userRef, traceparent, mandateId: mandate.id }, randomUUID());
    assert.equal(refused.isError, true);
    assert.ok(refused.content[0].text.includes("https://service-public.bj/public/services/service/PS00328"), refused.content[0].text);
    const found = await call("procedures.search", { query: "comment renouveler mon passeport", locale: "fr" });
    assert.equal(found.items[0].id, "PS00328");
    assert.equal(found.items[0].assistedFiling, false);
  });
});
