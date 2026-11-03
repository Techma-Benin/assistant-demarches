import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { isolatedDatabase } from "./helpers.mjs";
import { database, migrate, provision } from "../dist/apps/backend/src/database.js";
import { Conversations } from "../dist/apps/backend/src/conversations.js";
import { Agent } from "../dist/apps/backend/src/agent.js";
import { identifier } from "../dist/apps/backend/src/domain.js";
import { catalog } from "../dist/apps/backend/src/tooling.js";
import { HttpModels } from "../dist/apps/backend/src/model.js";
import { resolveModelFromEnv } from "../dist/apps/backend/src/model-env.js";
import { UNAVAILABLE_BLOCKS } from "../dist/apps/backend/src/model-reply.js";

const enabled = process.env.RUN_LIVE_MODEL === "1";
const rounds = Math.max(1, Number(process.env.LIVE_MODEL_ROUNDS ?? 1) || 1);
const tp = "00-" + "1".repeat(32) + "-" + "2".repeat(16) + "-01";
const MAX_LIVE_REQUESTS = 12;
const MIN_GAP_MS = 7000;

function providerMessage(body) {
  try {
    const parsed = JSON.parse(body);
    const record = Array.isArray(parsed) ? parsed[0] : parsed;
    const err = record?.error && typeof record.error === "object" ? record.error : record;
    return typeof err?.message === "string" ? err.message : body.slice(0, 240);
  } catch {
    return body.slice(0, 240);
  }
}

test("live model: casier, passeport and assistant role are accepted with gated deltas", {
  skip: !enabled,
  timeout: 300000,
}, async (t) => {
  const envPath = fileURLToPath(new URL("../../../.env", import.meta.url));
  if (existsSync(envPath)) process.loadEnvFile(envPath);
  const geminiKey = process.env.GEMINI_API_KEY_2;
  assert.ok(geminiKey, "GEMINI_API_KEY_2 must be set locally");
  const env = {
    ...process.env,
    MODEL_API_KEY: geminiKey,
    MODEL_PROVIDER: "gemini",
    MODEL_NAME: "gemini-3.5-flash-lite",
  };
  const config = resolveModelFromEnv(env);
  assert.ok(config, "Gemini live model must resolve");
  assert.equal(config.model, "gemini-3.5-flash-lite");
  const fixtures = JSON.parse(readFileSync(new URL("../../../contracts/v2/examples.json", import.meta.url)));
  const casier = fixtures.schemas.Procedure;
  const passeport = {
    ...casier,
    id: "PS00158",
    title: "Délivrance du passeport biométrique",
    administrationId: "mae",
    summary: "Cette démarche permet d’obtenir un passeport biométrique. Pièces : extrait d’acte de naissance, photos d’identité, ancien passeport le cas échéant.",
    authority: "Direction des Passeports",
    feeFcfa: 20000,
    processingDays: 15,
    inPerson: {
      ...casier.inPerson,
      fee: "20 000 FCFA",
      delay: "15 jours",
      documents: "* Extrait d'acte de naissance\n* Photos d'identité",
    },
    source: {
      procedureId: "PS00158",
      url: "https://service-public.bj/public/services/service/PS00158",
      retrievedAt: casier.source.retrievedAt,
    },
  };
  const procedures = [casier, passeport];
  const pg = await isolatedDatabase();
  const pool = database(pg.connection);
  t.after(async () => { await pool.end(); await pg.close(); });
  await migrate(pool);
  await provision(pool, "global", "models", config);
  await pool.query("INSERT INTO backend_mcp_servers(administration_id,id,body) VALUES('global','tooling',$1)", [JSON.stringify({ id: "tooling", name: "Tooling", url: "http://127.0.0.1:9999/mcp", enabled: true, transport: "streamable-http", auth: { type: "bearer", secretRef: "backend-agent" }, policy: "techma" })]);
  for (const tool of catalog)
    await pool.query("INSERT INTO backend_mcp_tools(administration_id,server_id,name,definition,available,enabled,requires_mandate) VALUES('global','tooling',$1,$2,true,true,$3)", [tool.name, tool, Boolean(tool._meta?.["bj.techma/requiresMandate"])]);
  const conversations = new Conversations(pool);
  let liveRequests = 0;
  let lastAt = 0;
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (url, init) => {
    const href = String(url);
    if (href.includes("generativelanguage.googleapis.com") || href.includes("api.groq.com")) {
      liveRequests += 1;
      if (liveRequests > MAX_LIVE_REQUESTS) throw new Error("live request budget exceeded");
      const wait = lastAt ? MIN_GAP_MS - (Date.now() - lastAt) : 0;
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      lastAt = Date.now();
    }
    let res;
    try {
      res = await originalFetch(url, init);
    } catch (error) {
      const message = error instanceof Error ? error.message : "network_error";
      t.diagnostic(JSON.stringify({ liveStop: true, liveRequests, providerMessage: message }));
      throw new Error("live provider stop: network " + message);
    }
    if (res.status === 401 || res.status === 403 || res.status === 429) {
      const message = providerMessage(await res.text());
      t.diagnostic(JSON.stringify({ liveStop: true, liveRequests, status: res.status, providerMessage: message }));
      throw new Error("live provider stop: " + res.status + " " + message);
    }
    return res;
  };
  const models = new HttpModels({}, env);
  const tooling = {
    async discover() { return catalog; },
    async call(_url, _auth, name, args) {
      let value;
      if (name === "procedures.get") {
        value = procedures.find((item) => item.id === args.procedureId);
        if (!value) throw new Error("unknown procedure");
      } else if (name === "procedures.search") {
        const query = String(args.query ?? "").toLowerCase();
        const items = procedures.filter((item) => item.title.toLowerCase().includes(query.replace("quels documents pour un ", "").replace("comment faire un ", ""))
          || (query.includes("casier") && item.id === casier.id)
          || (query.includes("passeport") && item.id === passeport.id));
        value = { items: items.length ? items : procedures };
      } else if (name === "request.create") {
        throw new Error("request.create must be blocked for guests");
      } else {
        throw new Error("unexpected tool");
      }
      return { structuredContent: value, content: [{ type: "text", text: JSON.stringify(value) }] };
    },
  };
  const agent = new Agent(pool, conversations, models, tooling);
  const user = { userRef: identifier("usr"), administrationId: "global", channel: "web", authenticated: true, expiresAt: Date.now() + 300000, roles: new Set() };
  const guest = { ...user, userRef: identifier("gst"), authenticated: false };
  const questions = [
    { text: "Quels documents faut-il pour un casier judiciaire ?", needSource: casier.source.procedureId },
    { text: "comment fonctionne l'assistant ?", needSource: null },
    { text: "Je veux demander mon casier judiciaire", needSource: casier.source.procedureId, guest: true, login: true },
  ];
  const results = [];
  for (let round = 0; round < rounds; round++) {
    for (const question of questions) {
      const actor = question.guest ? guest : user;
      const conversation = await conversations.create(actor, { locale: "fr" }, identifier("key"));
      const message = { id: identifier("msg"), content: { type: "text", text: question.text }, sentAt: new Date().toISOString() };
      await conversations.accept(actor, conversation.id, message, identifier("key"), tp);
      const received = (await conversations.page(actor.userRef, conversation.id)).items[0];
      let processError;
      try { await agent.process(conversation.id); }
      catch (error) {
        processError = error instanceof Error ? error.message : "process_failed";
        t.diagnostic(JSON.stringify({ liveRequests, processError }));
        if (/live provider stop|live request budget/.test(processError)) throw error;
      }
      const events = (await conversations.page(actor.userRef, conversation.id, received.id)).items;
      const sent = events.find((event) => event.data.kind === "message.sent");
      const deltas = events.filter((event) => event.data.kind === "message.delta");
      const tools = events.filter((event) => event.data.kind === "tool.called");
      const blocks = sent?.data.message.blocks ?? [];
      const unavailable = JSON.stringify(blocks) === JSON.stringify(UNAVAILABLE_BLOCKS);
      const sources = blocks.flatMap((block) => block.type === "text" ? block.sources : []);
      const ok = !processError
        && Boolean(sent)
        && !unavailable
        && blocks.some((block) => block.type === "text" && block.text.trim())
        && deltas.length > 0
        && events.indexOf(deltas[0]) < events.indexOf(sent)
        && (question.needSource ? sources.some((source) => source.procedureId === question.needSource && source.retrievedAt) : true)
        && (question.needSource ? tools.some((event) => /procedures\.(search|get)/.test(event.data.toolName)) : true)
        && (question.login ? blocks.some((block) => block.type === "loginRequired") : true);
      results.push({ round, needSource: question.needSource, login: question.login, ok, deltaCount: deltas.length });
      t.diagnostic(JSON.stringify({
        round, text: question.text, ok, deltaCount: deltas.length, sourceCount: sources.length,
        fallback: Boolean(sent) && unavailable, liveRequests,
        kinds: events.map((event) => event.data.kind),
        blockTypes: blocks.map((block) => block.type),
        processError: processError || undefined,
      }));
    }
  }
  t.diagnostic(JSON.stringify({ liveRequests, passed: results.filter((item) => item.ok).length, total: results.length }));
  assert.ok(results.length === rounds * questions.length);
  assert.ok(results.every((item) => item.ok), "every live case must be accepted");
});
