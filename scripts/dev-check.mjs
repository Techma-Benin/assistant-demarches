#!/usr/bin/env node
// Diagnose a running local stack the way the front would: health, then guest → conversation → message → events.
import { randomBytes } from "node:crypto";
import { PORTS, URLS } from "./dev/local-config.mjs";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const backendUrl = option("--backend-url", URLS.backend).replace(/\/$/, "");
const interfaceUrl = option("--interface-url", URLS.interface).replace(/\/$/, "");
const timeoutMs = Number(option("--timeout", "60000"));
const failures = [];
const lines = [];

const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const identifier = (prefix) => {
  let time = BigInt(Date.now());
  let timestamp = "";
  for (let i = 0; i < 10; i++) {
    timestamp = alphabet[Number(time % 32n)] + timestamp;
    time /= 32n;
  }
  return prefix + "_" + timestamp + [...randomBytes(16)].map((byte) => alphabet[byte & 31]).join("");
};
const traceparent = () => `00-${randomBytes(16).toString("hex")}-${randomBytes(8).toString("hex")}-01`;
const key = () => randomBytes(12).toString("hex");

function mark(ok, title, detail, hint) {
  const symbol = ok ? "✔" : "✘";
  const text = `${symbol} ${title} — ${detail}`;
  lines.push(text);
  console.log(text);
  if (!ok) {
    if (hint) {
      console.log(`    → ${hint}`);
      lines.push(`    → ${hint}`);
    }
    failures.push(title);
  }
}

async function get(url, init = {}) {
  try {
    const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(8000), ...init });
    const text = await response.text();
    let json;
    try { json = JSON.parse(text); } catch { json = undefined; }
    return { ok: response.ok, status: response.status, json, text, error: undefined };
  } catch (error) {
    return { ok: false, status: 0, json: undefined, text: "", error: error instanceof Error ? error.message : "injoignable" };
  }
}

function diagnose(status, json) {
  if (status === 404 || status === 405) return "endpoint absent côté backend (404/405) — vérifier routes.ts / le contrat v2";
  if (status === 401 || status === 403) return "auth (401/403) — jeton invité, CORS ou Keycloak";
  if (status === 503 || json?.code === "UPSTREAM_UNAVAILABLE") return "503 UPSTREAM_UNAVAILABLE — modèle, Tooling ou X-Road";
  if (status === 0) return "service injoignable — pnpm dev n'a pas démarré ce processus";
  return `HTTP ${status}${json?.detail ? " : " + json.detail : ""}`;
}

console.log(`Vérification de la pile locale (backend ${backendUrl})\n`);

const services = [
  ["Backend", `${backendUrl}/health`, PORTS.backend],
  ["Tooling", `${URLS.tooling}/health`, PORTS.tooling],
  ["X-Road", `${URLS.xroad}/health`, PORTS.xroad],
  ["Keycloak", `${URLS.issuer}`, PORTS.keycloak],
];
for (const [name, url] of services) {
  const result = await get(url);
  mark(
    result.ok,
    `${name} /health`,
    result.ok ? `HTTP ${result.status}` : result.error ?? diagnose(result.status, result.json),
    result.ok ? undefined : `Lancer \`pnpm dev\` et attendre que ${name} écoute.`,
  );
}

const ready = await get(`${backendUrl}/health/ready`);
if (!ready.json) {
  mark(false, "Backend /health/ready", ready.error ?? diagnose(ready.status, ready.json), "Le backend n'expose pas encore /health/ready ou n'est pas démarré.");
} else {
  for (const name of ["model", "tooling", "mcpTools", "xroad", "oidc", "database"]) {
    const item = ready.json[name];
    if (!item) continue;
    mark(Boolean(item.ok), `ready.${name}`, item.detail, item.ok ? undefined : "Voir BACKEND.md « Brancher le front ».");
  }
}

const guest = await get(`${backendUrl}/v1/guest-sessions`, {
  method: "POST",
  headers: { traceparent: traceparent() },
});
if (!guest.ok || !guest.json?.token) {
  mark(false, "POST /v1/guest-sessions", diagnose(guest.status, guest.json), "Échec avant toute conversation : problème backend, pas front.");
} else {
  mark(true, "POST /v1/guest-sessions", "session invitée créée");
  const token = guest.json.token;
  const auth = { Authorization: `Bearer ${token}`, traceparent: traceparent(), "Idempotency-Key": key(), "Content-Type": "application/json" };
  const created = await get(`${backendUrl}/v1/conversations`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ locale: "fr" }),
  });
  if (!created.ok || !created.json?.id) {
    mark(false, "POST /v1/conversations", diagnose(created.status, created.json), created.status === 404 || created.status === 405 ? "Le front appelle un chemin que le backend n'implémente pas." : undefined);
  } else {
    mark(true, "POST /v1/conversations", created.json.id);
    const conversationId = created.json.id;
    const sentAt = new Date().toISOString();
    const message = await get(`${backendUrl}/v1/conversations/${conversationId}/messages`, {
      method: "POST",
      headers: { ...auth, "Idempotency-Key": key(), traceparent: traceparent() },
      body: JSON.stringify({ id: identifier("msg"), content: { type: "text", text: "Bonjour, ceci est un test de diagnostic." }, sentAt }),
    });
    if (message.status === 202) {
      mark(true, "POST …/messages", "202 accepted");
      const deadline = Date.now() + timeoutMs;
      let sent = false;
      let lastStatus = 0;
      while (Date.now() < deadline) {
        const events = await get(`${backendUrl}/v1/conversations/${conversationId}/events`, {
          headers: { Authorization: `Bearer ${token}`, traceparent: traceparent() },
        });
        lastStatus = events.status;
        const items = events.json?.items ?? [];
        const sentEvent = items.find((item) => (item.data?.kind ?? item.type) === "message.sent" || String(item.data?.kind ?? item.type).includes("message.sent"));
        if (sentEvent) {
          const text = JSON.stringify(sentEvent.data?.message ?? sentEvent);
          if (/n[’']a pas pu être (terminé|produite)|unique modèle actif/i.test(text)) {
            mark(false, "GET …/events jusqu'à message.sent", "message.sent de repli — l'agent a abandonné", "Souvent : aucun modèle actif (MODEL_API_KEY) ou Tooling/MCP injoignable. Relancer avec une clé, ou MODEL_BASE_URL d'un serveur factice.");
            sent = "fallback";
          } else {
            sent = true;
          }
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
      if (sent === true) mark(true, "GET …/events jusqu'à message.sent", "l'agent a répondu");
      else if (sent === "fallback") { /* already marked */ }
      else if (lastStatus === 404 || lastStatus === 405) mark(false, "GET …/events", "endpoint absent côté backend");
      else if (lastStatus === 401 || lastStatus === 403) mark(false, "GET …/events", diagnose(lastStatus), "Le jeton invité n'est pas accepté pour lire les événements.");
      else mark(false, "GET …/events jusqu'à message.sent", `timeout ${timeoutMs} ms — agent bloqué`, "Souvent : aucun modèle actif (MODEL_API_KEY) ou Tooling/MCP injoignable. Relancer avec une clé, ou MODEL_BASE_URL d'un serveur factice.");
    } else {
      mark(false, "POST …/messages", diagnose(message.status, message.json), message.status === 404 || message.status === 405 ? "endpoint absent côté backend" : undefined);
    }
  }
}

const web = await get(interfaceUrl);
if (web.status === 0) {
  mark(false, "Interface", `injoignable sur ${interfaceUrl}`, "Interface non lancée : paquet absent, ou `pnpm dev` sans apps/interface/web.");
} else {
  mark(web.ok, "Interface", `HTTP ${web.status} sur ${interfaceUrl}`);
  // Future interface (techma/interface/redesign): public BFF at /api/backend/v1/home.
  const proxied = await get(`${interfaceUrl}/api/backend/v1/home`, { headers: { traceparent: traceparent() } });
  if (proxied.status === 0) {
    mark(false, "Proxy interface → backend", "l'interface ne répond plus");
  } else if (proxied.ok) {
    mark(true, "Proxy interface → backend", "GET /api/backend/v1/home atteint le backend");
  } else if (proxied.status === 404 || proxied.status === 405) {
    const direct = await get(`${interfaceUrl}/v1/guest-sessions`, { method: "POST", headers: { traceparent: traceparent() } });
    if (direct.ok || direct.status === 201) {
      mark(true, "Proxy interface → backend", "l'origine 3000 relaie /v1 vers le backend");
    } else {
      mark(true, "Proxy interface → backend", "pas de BFF /api/backend sur l'origine 3000 (le front parlera au backend 4010, ou le paquet n'est pas celui de la redesign)");
    }
  } else {
    mark(false, "Proxy interface → backend", diagnose(proxied.status, proxied.json), "Le proxy front n'atteint pas le backend.");
  }
}

console.log("");
if (failures.length) {
  console.log(`Résumé : ${failures.length} échec(s) — ${failures.join(", ")}.`);
  process.exitCode = 1;
} else {
  console.log("Résumé : pile joignable, parcours invité → message.sent OK.");
}
