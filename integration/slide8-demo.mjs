import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { startStack, until } from "./local-stack.mjs";
import { McpGateway } from "../apps/backend/dist/apps/backend/src/tooling.js";
import { ServiceTokens } from "../apps/backend/dist/apps/backend/src/runtime.js";
import { seedDirectory } from "../apps/backend/dist/apps/backend/src/directory-seed.js";

// Pile réelle de la slide 8 pour la console : un casier En attente (Justice), une authentification de diplôme Complétée (Enseignement supérieur).
const stack = await startStack({ backendPort: Number(process.env.INTEGRATION_BACKEND_PORT ?? 4110), toolingPort: Number(process.env.INTEGRATION_TOOLING_PORT ?? 4130), worker: false, xroad: true });
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => stack.close().then(() => process.exit(0), error => { console.error(error); process.exit(1); }));
await seedDirectory(stack.pool, JSON.parse(readFileSync(new URL("../apps/backend/seeds/demo-deux-bureaux.json", import.meta.url))));

const traceparent = "00-" + randomUUID().replaceAll("-", "") + "-" + randomUUID().replaceAll("-", "").slice(0, 16) + "-01";
async function api(path, { method = "GET", body, binary = false } = {}) {
  const response = await fetch(stack.backendUrl + path, {
    method, headers: { Authorization: `Bearer ${stack.tokens.user}`, traceparent, "Idempotency-Key": randomUUID(),
      ...(body === undefined ? {} : { "Content-Type": binary ? "application/octet-stream" : "application/json" }),
      ...(binary ? { "X-File-Mime-Type": "application/pdf" } : {}),
    }, body: body === undefined ? undefined : binary ? body : JSON.stringify(body),
  });
  const value = await response.json();
  if (!response.ok) throw new Error(`${method} ${path} : ${response.status} ${JSON.stringify(value)}`);
  return value;
}
const credentials = new ServiceTokens();
const gateway = new McpGateway(new Set([stack.toolingUrl + "/mcp"]), () => credentials.get("backend-agent", "tools:call", "techma-tooling"));

/** Consent, then what the agent does in the chat: create, fill, attach, submit, pay. */
async function file(procedureId, fields, documentTypes) {
  const conversation = await api("/v1/conversations", { method: "POST", body: { channel: "web", locale: "fr" } });
  const challenge = await api(`/v1/conversations/${conversation.id}/mandate-challenges`, { method: "POST", body: { procedureId, scopes: ["requests:write", "documents:write", "requests:submit"] } });
  const mandate = await api(`/v1/conversations/${conversation.id}/mandates`, { method: "POST", body: { challengeId: challenge.id, accepted: true } });
  const call = async (name, args) => {
    const result = await gateway.call(stack.toolingUrl + "/mcp", "backend-agent", name, args, { conversationId: conversation.id, userRef: conversation.userRef, traceparent, mandateId: mandate.id }, randomUUID());
    if (result.isError) throw new Error(`${name} : ${result.content?.[0]?.text}`);
    return result.structuredContent;
  };
  const requestId = (await call("request.create", { procedureId })).id;
  await call("request.update", { requestId, fields });
  for (const documentType of documentTypes) {
    const upload = await api("/v1/files", { method: "POST", body: stack.syntheticFile, binary: true });
    await call("documents.attach", { requestId, fileId: upload.id, documentType });
  }
  await call("request.submit", { requestId });
  await until(async () => (await call("request.status", { requestId })).status === "submitted", `dépôt ${procedureId}`);
  await call("request.pay", { requestId });
  return requestId;
}

// Fiches officielles de service-public.bj : casier judiciaire (PS00373), authentification de diplôme du supérieur (PS00254).
const casier = await file("PS00373", { adresseDomicile: "Cotonou, Cadjèhoun", profession: "Comptable", nombreEnfantsACharge: 2, situationMatrimoniale: "Marié" }, ["extrait-acte-naissance"]);
const diplome = await file("PS00254", {}, ["diplome-a-authentifier", "diplome-entree-formation"]);
await until(async () => (await stack.pool.query("SELECT count(*)::int AS n FROM backend_work_items")).rows[0].n === 2, "deux dossiers dans les files");

const tokens = { justice: await stack.sign({}, "justice-agent"), enseignement: await stack.sign({}, "enseignement-agent"), super: await stack.sign({}, "demo-super-admin") };
const tokenFile = join(stack.directory, "admin-demo-tokens.json");
writeFileSync(tokenFile, JSON.stringify(tokens));
console.log(`Pile slide 8 prête — fiches officielles de service-public.bj ; dépôt, paiement, dossiers et usagers simulés.
Backend : ${stack.backendUrl}   Tooling : ${stack.toolingUrl}/mcp   X-Road simulé : ${stack.xroadUrl}/
Casier (Justice, En attente) : ${casier}
Authentification de diplôme (Enseignement supérieur) : ${diplome}
ADMIN_DEMO_TOKENS (8 h) : ${tokenFile}
Ctrl+C supprime les bases, fichiers et clés de cette session.`);
