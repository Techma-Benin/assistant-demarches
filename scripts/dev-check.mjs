#!/usr/bin/env node
// Diagnose a running local stack the way the front would: health, then guest → conversation → message → events.
import { randomBytes, randomUUID } from "node:crypto";
import WebSocket from "ws";
import { PORTS, URLS } from "./dev/local-config.mjs";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const backendUrl = option("--backend-url", URLS.backend).replace(/\/$/, "");
const interfaceUrl = option("--interface-url", URLS.interface).replace(/\/$/, "");
const timeoutMs = Number(option("--timeout", "60000"));
const question = option("--question", "Bonjour, comment fonctionne l'assistant ?");
// Deltas received over less than this many ms before message.sent were not streamed during the generation.
const minStreamMs = Number(option("--min-stream-ms", "150"));
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

let proxyReachable = false;
let bffPresent = false; // the Interface exposes /api/backend, even when /v1/home itself fails upstream
const web = await get(interfaceUrl);
if (web.status === 0) {
  mark(false, "Interface", `injoignable sur ${interfaceUrl}`, "Interface non lancée : paquet absent, ou `pnpm dev` sans apps/interface/web.");
} else {
  mark(web.ok, "Interface", `HTTP ${web.status} sur ${interfaceUrl}`);
  // Future interface (techma/interface/redesign): public BFF at /api/backend/v1/home.
  const proxied = await get(`${interfaceUrl}/api/backend/v1/home`, { headers: { traceparent: traceparent() } });
  proxyReachable = proxied.ok;
  bffPresent = proxied.status !== 0 && proxied.status !== 404 && proxied.status !== 405;
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

// What the browser does through the Interface: BFF cookie, conversation, WebSocket ticket with the Interface origin,
// message, then the events until message.sent (apps/interface/web src/lib/c1-client.ts and conversation-stream.ts).
async function browserJourney() {
  const jar = new Map();
  const remember = (headers) => {
    for (const line of headers ?? []) {
      const [pair] = line.split(";");
      const at = pair.indexOf("=");
      if (at > 0) jar.set(pair.slice(0, at).trim(), pair.slice(at + 1).trim());
    }
  };
  async function request(method, path, options) {
    try {
      const response = await fetch(interfaceUrl + path, {
        method,
        redirect: "manual",
        signal: AbortSignal.timeout(15000),
        headers: {
          traceparent: traceparent(),
          ...(options?.key ? { "idempotency-key": options.key } : {}),
          ...(options?.body !== undefined ? { "content-type": "application/json" } : {}),
          ...(jar.size ? { cookie: [...jar].map(([name, value]) => `${name}=${value}`).join("; ") } : {}),
          ...(options?.headers ?? {}),
        },
        body: options?.rawBody ?? (options?.body !== undefined ? JSON.stringify(options.body) : undefined),
      });
      remember(response.headers.getSetCookie?.());
      const text = await response.text();
      let json;
      try { json = JSON.parse(text); } catch { json = undefined; }
      return { ok: response.ok, status: response.status, json, text };
    } catch (error) {
      return { ok: false, status: 0, error: error instanceof Error ? error.message : "injoignable" };
    }
  }
  const created = await request("POST", "/api/backend/v1/conversations", { body: { locale: "fr" }, key: randomUUID() });
  if (!created.ok || !created.json?.id) {
    mark(false, "Parcours navigateur : créer la conversation", diagnose(created.status, created.json), "Le BFF de l'Interface n'a pas obtenu de session invitée du Backend (POST /v1/guest-sessions).");
    return;
  }
  mark(true, "Parcours navigateur : conversation via l'Interface", `${created.json.id} (cookie de session ${jar.size ? "posé" : "ABSENT"})`);
  const conversationId = created.json.id;
  const ticket = await request("POST", `/api/backend/v1/conversations/${conversationId}/socket-ticket`, { key: randomUUID() });
  if (!ticket.ok || !ticket.json?.url) {
    mark(false, "Parcours navigateur : socket-ticket", diagnose(ticket.status, ticket.json));
    return;
  }
  const origin = new URL(interfaceUrl).origin;
  const frames = [];
  const startedAt = Date.now();
  const socket = new WebSocket(ticket.json.url, { origin });
  const opened = await new Promise((resolve) => {
    socket.once("open", () => resolve("open"));
    socket.once("unexpected-response", (_request, response) => resolve(`HTTP ${response.statusCode}`));
    socket.once("error", (error) => resolve(error.message));
    setTimeout(() => resolve("timeout"), 8000);
  });
  if (opened !== "open") {
    mark(false, "Parcours navigateur : WebSocket", `refusé (${opened}) pour l'origine ${origin} sur ${new URL(ticket.json.url).origin}`, "Vérifier CORS_ORIGINS (origine de l'Interface) et PUBLIC_URL du Backend (URL du ticket).");
  } else {
    mark(true, "Parcours navigateur : WebSocket", `ouverte depuis l'origine ${origin} (${new URL(ticket.json.url).origin})`);
  }
  socket.on("message", (data) => frames.push({ at: Date.now() - startedAt, event: JSON.parse(data.toString()) }));
  const messageId = identifier("msg");
  const sentAt = new Date().toISOString();
  const postedAt = Date.now();
  const posted = await request("POST", `/api/backend/v1/conversations/${conversationId}/messages`, {
    body: { id: messageId, content: { type: "text", text: question }, sentAt },
    key: messageId,
  });
  if (posted.status !== 202) {
    mark(false, "Parcours navigateur : message", diagnose(posted.status, posted.json));
    socket.close();
    return;
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && !frames.some((frame) => frame.event.data?.kind === "message.sent")) await new Promise((resolve) => setTimeout(resolve, 100));
  socket.close();
  const events = frames.map((frame) => frame.event);
  const sent = events.find((event) => event.data?.kind === "message.sent");
  if (opened !== "open") {
    mark(false, "Parcours navigateur : événements", "aucun flux WebSocket (l'Interface retombera sur le polling)");
    return;
  }
  if (!sent) {
    mark(false, "Parcours navigateur : message.sent par WebSocket", `rien reçu en ${timeoutMs} ms (trames : ${events.map((event) => event.data?.kind).join(", ") || "aucune"})`, "Agent bloqué : modèle, Tooling ou MCP.");
    return;
  }
  const deltas = events.filter((event) => event.data.kind === "message.delta");
  const text = sent.data.message.blocks.filter((block) => block.type === "text").map((block) => block.text).join("");
  const assembled = deltas.sort((a, b) => a.data.index - b.data.index).map((event) => event.data.delta).join("");
  const kinds = events.map((event) => event.data.kind);
  const received = kinds.indexOf("message.received") >= 0;
  const order = received && kinds.indexOf("message.received") < kinds.indexOf("message.sent") && kinds.lastIndexOf("message.delta") < kinds.indexOf("message.sent");
  const firstDelta = frames.find((frame) => frame.event.data.kind === "message.delta");
  const lastDelta = frames.findLast((frame) => frame.event.data.kind === "message.delta");
  const last = frames.find((frame) => frame.event.data.kind === "message.sent");
  const posted_at = postedAt - startedAt;
  const sources = sent.data.message.blocks.flatMap((block) => (block.type === "text" ? block.sources : []));
  mark(order, "Parcours navigateur : ordre des événements", `${kinds.length} trames : message.received → ${deltas.length} × message.delta → message.sent (blocs : ${sent.data.message.blocks.map((block) => block.type).join(", ")} ; ${sources.length} source(s))`);
  mark(deltas.length === 0 || assembled === text, "Parcours navigateur : deltas = message.sent", deltas.length ? `texte assemblé identique (${text.length} car., premier delta à +${firstDelta.at} ms, message.sent à +${last.at} ms)` : "aucun delta (la réponse n'a pas de texte)", "Le texte assemblé des deltas diffère du bloc text final.");
  // The reply must be streamed while the model writes it: deltas bunched right before message.sent mean the Backend
  // waited for the end of the generation (the exact defect this check guards against).
  if (deltas.length === 0) {
    mark(true, "Parcours navigateur : streaming en direct", "sans objet (aucun delta : réponse sans texte)");
  } else {
    const streamMs = last.at - firstDelta.at;
    const spreadMs = lastDelta.at - firstDelta.at;
    const detail = `message envoyé à +${posted_at} ms ; premier delta à +${firstDelta.at} ms (${firstDelta.at - posted_at} ms après l'envoi), dernier à +${lastDelta.at} ms, message.sent à +${last.at} ms ; ${deltas.length} delta(s) répartis sur ${spreadMs} ms, ${streamMs} ms entre le premier delta et message.sent`;
    const grouped = deltas.length >= 3 && streamMs < minStreamMs;
    mark(
      !grouped,
      "Parcours navigateur : streaming en direct",
      grouped
        ? `deltas groupés juste avant message.sent — ${detail}`
        : detail,
      `Les ${deltas.length} deltas arrivent en moins de ${minStreamMs} ms avant message.sent : le Backend les émet après la fin de la génération au lieu de les écrire au fil du flux du modèle (agent.ts / live-reply.ts). Si le modèle est vraiment très rapide, baisser --min-stream-ms.`,
    );
  }
  if (args.includes("--voice")) await voiceJourney(request, origin);
}

// --voice : un enregistrement (en-tête EBML d'un webm) par POST /v1/files puis message audio ; vérifie la transcription.
async function voiceJourney(request, origin) {
  const created = await request("POST", "/api/backend/v1/conversations", { body: { locale: "fr" }, key: randomUUID() });
  if (!created.ok) {
    mark(false, "Vocal : conversation", diagnose(created.status, created.json));
    return;
  }
  const conversationId = created.json.id;
  const webm = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), randomBytes(2048)]);
  const uploaded = await request("POST", "/api/backend/v1/files", {
    rawBody: webm,
    headers: { "content-type": "application/octet-stream", "x-file-mime-type": "audio/webm" },
    key: randomUUID(),
  });
  if (uploaded.status !== 201) {
    mark(false, "Vocal : upload audio/webm", diagnose(uploaded.status, uploaded.json));
    return;
  }
  const ticket = await request("POST", `/api/backend/v1/conversations/${conversationId}/socket-ticket`, { key: randomUUID() });
  const frames = [];
  const socket = new WebSocket(ticket.json.url, { origin });
  socket.on("message", (data) => frames.push(JSON.parse(data.toString())));
  await new Promise((resolve) => { socket.once("open", resolve); socket.once("error", resolve); });
  const messageId = identifier("msg");
  await request("POST", `/api/backend/v1/conversations/${conversationId}/messages`, {
    body: { id: messageId, content: { type: "audio", fileId: uploaded.json.id }, sentAt: new Date().toISOString() },
    key: messageId,
  });
  const deadline = Date.now() + timeoutMs;
  const done = () => frames.some((event) => event.data.kind === "message.sent");
  while (Date.now() < deadline && !done()) await new Promise((resolve) => setTimeout(resolve, 100));
  socket.close();
  const transcript = frames.find((event) => event.data.kind === "message.received" && event.data.message.id === messageId && event.data.message.transcript);
  if (transcript) mark(true, "Vocal : transcription sur message.received", `« ${transcript.data.message.transcript} »`);
  else {
    const sent = frames.find((event) => event.data.kind === "message.sent");
    const reply = sent?.data.message.blocks.find((block) => block.type === "text")?.text ?? "aucune réponse";
    mark(false, "Vocal : transcription sur message.received", reply, "MODEL_API_KEY (ou TRANSCRIPTION_API_KEY_ENV) absente, fournisseur Whisper injoignable, ou audio de test refusé par un vrai fournisseur.");
  }
}

// The journey does not need /v1/home (X-Road catalogue): it only needs the BFF and a Backend that answers.
if (web.status !== 0 && bffPresent) await browserJourney();

console.log("");
if (failures.length) {
  console.log(`Résumé : ${failures.length} échec(s) — ${failures.join(", ")}.`);
  process.exitCode = 1;
} else {
  console.log("Résumé : pile joignable, parcours invité → message.sent OK.");
}
