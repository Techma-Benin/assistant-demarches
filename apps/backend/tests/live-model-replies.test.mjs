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
const rounds = Math.max(1, Number(process.env.LIVE_MODEL_ROUNDS ?? 3) || 3);
const tp = "00-" + "1".repeat(32) + "-" + "2".repeat(16) + "-01";

test("live model: casier, passeport and assistant role are accepted with gated deltas", {
  skip: !enabled,
  timeout: 300000,
}, async (t) => {
  const envPath = new URL("../../../.env", import.meta.url);
  if (existsSync(envPath)) process.loadEnvFile(fileURLToPath(envPath));
  const config = resolveModelFromEnv(process.env);
  assert.ok(config, "MODEL_API_KEY must be set locally");
  if (!process.env.MODEL_NAME && new URL(config.baseUrl).hostname === "api.groq.com")
    config.model = process.env.GROQ_LIVE_MODEL || "openai/gpt-oss-20b";
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
  const conversations = new Conversations(pool);
  const models = new HttpModels({});
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
      } else {
        throw new Error("unexpected tool");
      }
      return { structuredContent: value, content: [{ type: "text", text: JSON.stringify(value) }] };
    },
  };
  const agent = new Agent(pool, conversations, models, tooling);
  const user = { userRef: identifier("usr"), administrationId: "global", channel: "web", authenticated: true, expiresAt: Date.now() + 300000, roles: new Set() };
  const questions = [
    { text: "quels documents pour un casier judiciaire ?", needSource: casier.source.procedureId },
    { text: "comment faire un passeport ?", needSource: passeport.source.procedureId },
    { text: "comment fonctionne l'assistant ?", needSource: null },
  ];
  const results = [];
  for (let round = 0; round < rounds; round++) {
    for (const question of questions) {
      const conversation = await conversations.create(user, { locale: "fr" }, identifier("key"));
      const message = { id: identifier("msg"), content: { type: "text", text: question.text }, sentAt: new Date().toISOString() };
      await conversations.accept(user, conversation.id, message, identifier("key"), tp);
      const received = (await conversations.page(user.userRef, conversation.id)).items[0];
      let processError;
      try { await agent.process(conversation.id); }
      catch (error) { processError = error instanceof Error ? error.message : "process_failed"; }
      await new Promise((resolve) => setTimeout(resolve, 4000));
      const events = (await conversations.page(user.userRef, conversation.id, received.id)).items;
      const sent = events.find((event) => event.data.kind === "message.sent");
      const deltas = events.filter((event) => event.data.kind === "message.delta");
      const blocks = sent?.data.message.blocks ?? [];
      const unavailable = JSON.stringify(blocks) === JSON.stringify(UNAVAILABLE_BLOCKS);
      const sources = blocks.flatMap((block) => block.type === "text" ? block.sources : []);
      const ok = !processError
        && Boolean(sent)
        && !unavailable
        && blocks.some((block) => block.type === "text" && block.text.trim())
        && deltas.length > 0
        && events.indexOf(deltas[0]) < events.indexOf(sent)
        && (question.needSource ? sources.some((source) => source.procedureId === question.needSource && source.retrievedAt) : true);
      results.push({ round, needSource: question.needSource, ok, deltaCount: deltas.length });
      const fallback = Boolean(sent) && JSON.stringify(blocks) === JSON.stringify(UNAVAILABLE_BLOCKS);
      t.diagnostic(JSON.stringify({
        round, needSource: question.needSource, ok, deltaCount: deltas.length, sourceCount: sources.length, fallback,
        kinds: events.map((event) => event.data.kind),
        blockTypes: blocks.map((block) => block.type),
        processError: processError || undefined,
      }));
    }
  }
  const passed = results.filter((item) => item.ok).length;
  t.diagnostic(`live success ${passed}/${results.length}`);
  assert.ok(results.length === rounds * questions.length);
  const byQuestion = questions.map((question) => {
    const group = results.filter((item) => item.needSource === question.needSource);
    return { needSource: question.needSource, ok: group.filter((item) => item.ok).length, n: group.length };
  });
  t.diagnostic(JSON.stringify({ byQuestion }));
});
