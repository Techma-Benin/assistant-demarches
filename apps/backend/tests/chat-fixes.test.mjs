import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isolatedDatabase } from "./helpers.mjs";
import { database, migrate, provision } from "../dist/apps/backend/src/database.js";
import { Conversations, RESUME_AFTER_CONSENT, RESUME_AFTER_LOGIN, envelope } from "../dist/apps/backend/src/conversations.js";
import { transaction } from "../dist/apps/backend/src/transactions.js";
import { Agent } from "../dist/apps/backend/src/agent.js";
import { identifier } from "../dist/apps/backend/src/domain.js";
import { catalog } from "../dist/apps/backend/src/tooling.js";
import { LiveReply } from "../dist/apps/backend/src/live-reply.js";
import { coerceFieldValue, parseFormValues } from "../dist/apps/backend/src/form-values.js";
import {
  hasAdministrativeFact,
  presentModelReply,
  stripForeignUrls,
  honestReplyFromSystemBlocks,
  hasActionSystemBlocks,
} from "../dist/apps/backend/src/model-reply.js";

const fixtures = JSON.parse(readFileSync(new URL("../../../contracts/v2/examples.json", import.meta.url)));
const procedure = fixtures.schemas.Procedure;
const tp = "00-" + "3".repeat(32) + "-" + "4".repeat(16) + "-01";
const final = (text, sources = []) => ({ text: JSON.stringify({ blocks: [{ type: "text", text, sources }] }), calls: [] });
const toolCall = (name, args, id = "call-" + Math.random().toString(36).slice(2, 8)) => ({ text: "", calls: [{ id, name, arguments: JSON.stringify(args) }] });
const empty = { sources: [], requests: [] };
const evidence = { sources: [procedure.source], requests: [], procedures: [procedure] };

// ---------------------------------------------------------------- A. replies refused wrongly

test("administrative facts: figures and the bare words documents/pièces/tarif/délai are not facts by themselves", () => {
  assert.equal(hasAdministrativeFact("Je peux vous aider pour vos documents."), false);
  assert.equal(hasAdministrativeFact("Quel tarif vous intéresse ? Et quel délai ?"), false);
  assert.equal(hasAdministrativeFact("Vous avez 2 enfants et j’ai 15 questions."), false);
  assert.equal(hasAdministrativeFact("Le coût est de 1000 FCFA."), true);
  assert.equal(hasAdministrativeFact("Le coût est de 1 000 F CFA."), true);
  assert.equal(hasAdministrativeFact("Comptez 500 XOF."), true);
  assert.equal(hasAdministrativeFact("Réponse sous 3 jours."), true);
  assert.equal(hasAdministrativeFact("Les pièces requises sont les suivantes."), true);
  assert.equal(hasAdministrativeFact("Les documents à fournir sont listés."), true);
  assert.equal(hasAdministrativeFact("Le délai est de dix jours."), true);
  assert.equal(hasAdministrativeFact("Je peux vous renseigner sur les pièces à fournir, les tarifs, les délais et le lien officiel."), false);
  assert.equal(hasAdministrativeFact("La démarche PS00373."), true);
  assert.throws(() => presentModelReply(JSON.stringify({ blocks: [{ type: "text", text: "Réponse sous 3 jours.", sources: [] }] }), empty));
  assert.deepEqual(presentModelReply(JSON.stringify({ blocks: [{ type: "text", text: "Je peux vous aider pour vos documents.", sources: [] }] }), empty)[0].sources, []);
});

test("a text block with sources absent or null means no source; any other non-array value is refused", () => {
  const withSources = (sources) => JSON.stringify({ blocks: [{ type: "text", text: "Bonjour.", ...(sources === undefined ? {} : { sources }) }] });
  assert.deepEqual(presentModelReply(withSources(undefined), empty)[0].sources, []);
  assert.deepEqual(presentModelReply(withSources(null), empty)[0].sources, []);
  assert.throws(() => presentModelReply(withSources("PS00373"), empty), /Texte modèle invalide/);
  assert.throws(() => presentModelReply(withSources({}), empty), /Texte modèle invalide/);
});

test("stripForeignUrls removes foreign URLs only, keeps observed ones and tidies the text", () => {
  const known = procedure.source.url;
  assert.equal(stripForeignUrls("Voir https://autre.example/page pour plus.", evidence.sources), "Voir pour plus.");
  assert.equal(stripForeignUrls("Voir [le guide](https://autre.example/guide) ici.", evidence.sources), "Voir le guide ici.");
  assert.equal(stripForeignUrls("Détails (https://autre.example/x) ici.", evidence.sources), "Détails ici.");
  assert.equal(stripForeignUrls(`Fiche : ${known}/ merci`, evidence.sources), `Fiche : ${known}/ merci`);
  assert.equal(stripForeignUrls(`Voir [la fiche](${known}).`, evidence.sources), `Voir [la fiche](${known}).`);
  assert.equal(stripForeignUrls("Voir https://autre.example/page.", evidence.sources), "Voir .");
  assert.equal(stripForeignUrls("Aucune adresse ici.", []), "Aucune adresse ici.");
});

test("presentModelReply cleans foreign URLs, refuses an empty remainder and an unknown PS id, logs only a count", () => {
  const logged = [];
  const original = console.error;
  console.error = (line) => logged.push(String(line));
  try {
    const blocks = presentModelReply(JSON.stringify({ blocks: [{ type: "text", text: "Consultez https://autre.example/secret-ticket-42 pour la suite.", sources: [] }] }), empty);
    assert.equal(blocks[0].text, "Consultez pour la suite.");
    assert.throws(() => presentModelReply("https://autre.example/x", empty), (error) => error.reason === "empty_reply");
    assert.throws(() => presentModelReply("Voir PS99999 ou https://autre.example/x", evidence), (error) => error.reason === "unobserved_source");
    // A source cited in the array but never observed is still refused.
    assert.throws(() => presentModelReply(JSON.stringify({ blocks: [{ type: "text", text: "Bonjour.", sources: [{ procedureId: "PS99999", url: "https://autre.example/x" }] }] }), evidence), (error) => error.reason === "unobserved_source");
  } finally {
    console.error = original;
  }
  const events = logged.map((line) => JSON.parse(line)).filter((entry) => entry.event === "model.reply_url_removed");
  assert.ok(events.length >= 1);
  assert.equal(events[0].count, 1);
  assert.equal(logged.some((line) => line.includes("autre.example") || line.includes("secret-ticket")), false);
});

function fakeConversations(published) {
  return { pool: { async query() { return { rows: [] }; } }, async appendDelta(_c, _m, delta) { published.push(delta); return 1; } };
}
const feed = async (live, observed, chunks, options) => {
  const listener = await live.attempt(observed, options);
  for (const chunk of chunks) listener.onTextDelta(chunk);
  return listener;
};

test("live deltas: a foreign URL in the text is removed, not a reason to stop; unknown PS ids and out-of-text URLs still stop", async () => {
  const stream = (text, sources = "[]") => [`{"blocks":[{"type":"text","text":"${text}","sources":${sources}}]}`];

  let published = [];
  let live = new LiveReply(fakeConversations(published), "cnv", "msg", tp, 0);
  let listener = await feed(live, [], stream("Voir https://autre.example/page pour la suite. "));
  listener.complete(stream("Voir https://autre.example/page pour la suite. ")[0]);
  await live.close();
  assert.equal(published.join(""), "Voir pour la suite.");

  published = [];
  live = new LiveReply(fakeConversations(published), "cnv", "msg", tp, 0);
  listener = await feed(live, [], stream("La démarche PS99999 existe bien. "));
  listener.complete(stream("La démarche PS99999 existe bien. ")[0]);
  await live.close();
  assert.equal(published.join(""), "");

  // A URL that sits outside the visible text (here in `sources`, before the text) mutes the attempt.
  published = [];
  live = new LiveReply(fakeConversations(published), "cnv", "msg", tp, 0);
  const sourcesFirst = '{"blocks":[{"type":"text","sources":[{"procedureId":"PS00373","url":"https://autre.example/x"}],"text":"Bonjour à tous. "}]}';
  listener = await feed(live, [procedure.source], [sourcesFirst]);
  listener.complete(sourcesFirst);
  await live.close();
  assert.equal(published.join(""), "");

  // An observed URL in the text goes out untouched.
  published = [];
  live = new LiveReply(fakeConversations(published), "cnv", "msg", tp, 0);
  const observedText = stream(`Fiche ${procedure.source.url} ok. `)[0];
  listener = await feed(live, [procedure.source], [observedText]);
  listener.complete(observedText);
  await live.close();
  assert.equal(published.join(""), `Fiche ${procedure.source.url} ok. `);
});

test("live deltas: a held attempt stays silent without using up the reply; publishVisible speaks after acceptance", async () => {
  const published = [];
  const live = new LiveReply(fakeConversations(published), "cnv", "msg", tp, 0);
  const held = await feed(live, [], ['{"blocks":[{"type":"text","text":"Texte écarté pour un appel forcé. ","sources":[]}]}'], { hold: true });
  held.complete('{"blocks":[{"type":"text","text":"Texte écarté pour un appel forcé. ","sources":[]}]}');
  await live.settle();
  assert.deepEqual(published, []);
  const next = await feed(live, [], ['{"blocks":[{"type":"text","text":"Réponse finale. ","sources":[]}]}']);
  next.complete('{"blocks":[{"type":"text","text":"Réponse finale. ","sources":[]}]}');
  await live.close();
  assert.equal(published.join(""), "Réponse finale. ");
});

// ---------------------------------------------------------------- C. form helpers

test("form values: only a JSON object is a form; strings follow the schema type", () => {
  assert.deepEqual(parseFormValues('{"a":"1"}'), { a: "1" });
  for (const bad of [undefined, null, "", "[1]", "3", '"x"', "{oops", "null"]) assert.equal(parseFormValues(bad), undefined);
  assert.equal(coerceFieldValue("2", { type: "integer" }), 2);
  assert.equal(coerceFieldValue(" 2 ", { type: "integer" }), 2);
  assert.equal(coerceFieldValue("2,5", { type: "number" }), 2.5);
  assert.equal(coerceFieldValue("2,5", { type: "integer" }), "2,5");
  assert.equal(coerceFieldValue("deux", { type: "integer" }), "deux");
  assert.equal(coerceFieldValue("2", { type: ["null", "integer"] }), 2);
  assert.equal(coerceFieldValue("2", { type: "string" }), "2");
  assert.equal(coerceFieldValue("Oui", { type: "boolean" }), true);
  assert.equal(coerceFieldValue("NON", { type: "boolean" }), false);
  assert.equal(coerceFieldValue("peut-être", { type: "boolean" }), "peut-être");
  assert.equal(coerceFieldValue(3, { type: "integer" }), 3);
  assert.equal(coerceFieldValue("2", undefined), "2");
});

// ---------------------------------------------------------------- D/E. copy

test("system copy: payment button, request being prepared, merged cards", () => {
  const payment = { type: "buttons", items: [{ id: "payment.confirm.req_01JD0000000000000000000001", label: "Confirmer 1 000 FCFA" }] };
  assert.equal(hasActionSystemBlocks([payment]), true);
  assert.equal(honestReplyFromSystemBlocks([payment])[0].text, "Confirmez le paiement avec le bouton ci-dessous.");
  const draft = { ...fixtures.schemas.Request, status: "draft", missing: ["profession"] };
  assert.equal(honestReplyFromSystemBlocks([{ type: "requestCard", request: draft }])[0].text, "Votre dossier est en préparation. Il reste des éléments à compléter.");
  assert.match(honestReplyFromSystemBlocks([{ type: "requestCard", request: { ...draft, missing: [] } }])[0].text, /a été préparé/);
});

// ---------------------------------------------------------------- agent harness

async function harness(t) {
  const pg = await isolatedDatabase();
  const pool = database(pg.connection);
  t.after(async () => { await pool.end(); await pg.close(); });
  await migrate(pool);
  const conversations = new Conversations(pool);
  await provision(pool, "global", "models", { id: "test", label: "Test", baseUrl: "http://127.0.0.1:9/v1", protocol: "chat-completions", model: "synthetic", apiKeyRef: "TEST_KEY", active: true, temperature: 0 });
  await pool.query("INSERT INTO backend_mcp_servers(administration_id,id,body) VALUES('global','tooling',$1)", [JSON.stringify({ id: "tooling", name: "Tooling", url: "http://127.0.0.1:9999/mcp", enabled: true, transport: "streamable-http", auth: { type: "bearer", secretRef: "backend-agent" }, policy: "techma" })]);
  for (const tool of catalog)
    await pool.query("INSERT INTO backend_mcp_tools(administration_id,server_id,name,definition,available,enabled,requires_mandate) VALUES('global','tooling',$1,$2,true,true,$3)", [tool.name, tool, Boolean(tool._meta?.["bj.techma/requiresMandate"])]);

  const calls = [];
  const state = { amount: 1000, statusFails: false, failUpdate: undefined, procedureReads: 0 };
  const draftOf = (cid, id = identifier("req"), values = {}) => ({
    ...fixtures.schemas.Request,
    id,
    conversationId: cid,
    procedureId: procedure.id,
    status: "draft",
    missing: ["adresseDomicile", "profession", "nombreEnfantsACharge", "situationMatrimoniale"].filter((name) => values[name] === undefined),
    fields: ["adresseDomicile", "profession", "nombreEnfantsACharge", "situationMatrimoniale"].map((name) => ({ name, label: name, value: values[name] ?? null, source: values[name] === undefined ? null : "answer" })),
    caseId: null,
  });
  const store = new Map();
  const tooling = {
    async discover() { return catalog; },
    async call(_url, _auth, name, args, context, key) {
      calls.push({ name, args: structuredClone(args), context, key });
      const ok = (value) => ({ structuredContent: value, content: [{ type: "text", text: JSON.stringify(value) }] });
      if (name === "procedures.get") { state.procedureReads++; return ok(procedure); }
      if (name === "procedures.search") return ok({ items: [procedure], nextCursor: null });
      if (name === "request.create") {
        const request = draftOf(context.conversationId);
        store.set(request.id, request);
        return ok(request);
      }
      if (name === "request.update") {
        if (state.failUpdate) return { isError: true, content: [{ type: "text", text: JSON.stringify({ code: "INVALID_REQUEST", detail: state.failUpdate, traceId: "a".repeat(32) }) }] };
        const current = store.get(args.requestId) ?? draftOf(context.conversationId, args.requestId);
        const values = Object.fromEntries(current.fields.filter((field) => field.value !== null).map((field) => [field.name, field.value]));
        for (const field of args.fields) values[field.name] = field.value;
        const next = draftOf(context.conversationId, args.requestId, values);
        store.set(next.id, next);
        return ok(next);
      }
      if (name === "case.status") {
        if (state.statusFails) throw new Error("down");
        return ok({ ...fixtures.schemas.Case, status: "awaiting_payment", payment: { ...fixtures.schemas.Case.payment, amountFcfa: state.amount, status: "pending", reference: null, paidAt: null } });
      }
      if (name === "request.pay") return ok({ ...fixtures.schemas.Case, status: "in_review" });
      return ok({});
    },
  };
  const user = { userRef: identifier("usr"), administrationId: "global", channel: "web", authenticated: true, expiresAt: Date.now() + 60000, roles: new Set() };
  const guest = { ...user, userRef: identifier("usr"), authenticated: false };
  const mandate = async (cid, owner = user, scopes = ["requests:write", "requests:submit"]) => {
    const body = { id: identifier("mdt"), conversationId: cid, userRef: owner.userRef, procedureId: procedure.id, scopes, status: "active", expiresAt: new Date(Date.now() + 3600000).toISOString() };
    await pool.query("INSERT INTO backend_mandates(id,conversation_id,user_ref,body) VALUES($1,$2,$3,$4)", [body.id, cid, owner.userRef, body]);
  };
  const send = async (owner, cid, content) => {
    const message = { id: identifier("msg"), content, sentAt: new Date().toISOString() };
    await conversations.accept(owner, cid, message, identifier("key"), tp);
    return message;
  };
  const lastBlocks = async (cid) => (await pool.query("SELECT body->'data'->'message'->'blocks' AS blocks FROM backend_conversation_events WHERE conversation_id=$1 AND body->'data'->>'kind'='message.sent' ORDER BY seq DESC LIMIT 1", [cid])).rows[0]?.blocks ?? [];
  const pending = async (cid) => (await pool.query("SELECT pending_action FROM backend_conversations WHERE id=$1", [cid])).rows[0].pending_action;
  const called = (name) => calls.filter((entry) => entry.name === name);
  const process = (model, cid) => new Agent(pool, conversations, model, tooling).process(cid);
  /** A conversation whose last message.sent shows a request card (the form submits against it). */
  const withCard = async (owner, request) => {
    const conversation = await conversations.create(owner, { locale: "fr" }, identifier("key"));
    const first = await send(owner, conversation.id, { type: "text", text: "Bonjour" });
    const card = request ? request(conversation.id) : draftOf(conversation.id);
    store.set(card.id, card);
    await transaction(pool, (db) => conversations.complete(db, conversation.id, first.id, [{ type: "text", text: "Voici votre dossier.", sources: [] }, { type: "requestCard", request: card }], tp));
    return { conversation, card };
  };
  return { pool, conversations, tooling, calls, called, state, draftOf, user, guest, mandate, send, lastBlocks, pending, process, withCard, store };
}

const form = (values) => ({ type: "interaction", actionId: "form-casier", value: JSON.stringify(values) });

// ---------------------------------------------------------------- B. deterministic resume

test("B: the action blocked by login then consent is replayed without a new message and without the model's help", async (t) => {
  const h = await harness(t);
  const conversation = await h.conversations.create(h.guest, { locale: "fr" }, identifier("key"));
  const cid = conversation.id;
  // Left alone, this model only ever reads the catalogue.
  let modelCalls = 0;
  const readerOnly = {
    async generate(_config, history) {
      modelCalls++;
      return history.some((turn) => turn.role === "tool") ? final("Je prépare votre dossier.") : toolCall("procedures.get", { procedureId: procedure.id });
    },
  };
  await h.send(h.guest, cid, { type: "text", text: "Je veux déposer un casier judiciaire" });
  await h.process(readerOnly, cid);
  assert.equal(h.called("request.create").length, 0, "a guest never reaches the write tool");
  assert.equal((await h.lastBlocks(cid)).some((block) => block.type === "loginRequired"), true);
  assert.equal((await h.pending(cid))?.name, "request.create");

  // Login: the conversation becomes the user's, the Interface sends nothing.
  await h.pool.query("UPDATE backend_conversations SET user_ref=$2, body=jsonb_set(body,'{authenticated}','true'::jsonb) WHERE id=$1", [cid, h.user.userRef]);
  await transaction(h.pool, (db) => h.conversations.enqueueResume(db, cid, RESUME_AFTER_LOGIN));
  await h.process(readerOnly, cid);
  assert.equal(h.called("request.create").length, 0, "no mandate yet: the replayed call is blocked by the pipeline");
  assert.equal(h.called("procedures.get").length >= 1, true);
  assert.equal((await h.pending(cid))?.name, "request.create", "the new blocking is recorded again for the consent");

  // Consent: the same action leaves, exactly once, without a new user message.
  await h.mandate(cid);
  await transaction(h.pool, (db) => h.conversations.enqueueResume(db, cid, RESUME_AFTER_CONSENT));
  const before = (await h.pool.query("SELECT count(*)::int AS n FROM backend_messages WHERE conversation_id=$1 AND body->'content'->>'text' NOT IN ($2,$3)", [cid, RESUME_AFTER_LOGIN, RESUME_AFTER_CONSENT])).rows[0].n;
  await h.process(readerOnly, cid);
  assert.equal(h.called("request.create").length, 1);
  assert.ok(h.called("request.create")[0].context.mandateId);
  assert.equal((await h.lastBlocks(cid)).some((block) => block.type === "requestCard"), true);
  assert.equal(await h.pending(cid), null, "the waiting action is consumed");
  assert.equal(before, 1, "the user typed one message only");
});

test("B: a resume with nothing waiting forces no call", async (t) => {
  const h = await harness(t);
  const conversation = await h.conversations.create(h.user, { locale: "fr" }, identifier("key"));
  await transaction(h.pool, (db) => h.conversations.enqueueResume(db, conversation.id, RESUME_AFTER_CONSENT));
  let modelCalls = 0;
  await h.process({ async generate() { modelCalls++; return final("Bonjour."); } }, conversation.id);
  assert.equal(modelCalls, 1);
  assert.equal(h.calls.length, 0);
});

test("B: the migration recomputes lastMessageAt from the stored message events", async (t) => {
  const h = await harness(t);
  const conversation = await h.conversations.create(h.user, { locale: "fr" }, identifier("key"));
  const message = await h.send(h.user, conversation.id, { type: "text", text: "Bonjour" });
  await transaction(h.pool, (db) => h.conversations.complete(db, conversation.id, message.id, [{ type: "text", text: "Bonjour.", sources: [] }], tp));
  const expected = (await h.pool.query("SELECT body->>'time' AS time FROM backend_conversation_events WHERE conversation_id=$1 AND body->'data'->>'kind'='message.sent'", [conversation.id])).rows[0].time;
  await h.pool.query("UPDATE backend_conversations SET body=jsonb_set(body,'{lastMessageAt}','null'::jsonb) WHERE id=$1", [conversation.id]);
  await h.pool.query(readFileSync(new URL("../migrations/008_chat_fixes.sql", import.meta.url), "utf8"));
  const after = (await h.pool.query("SELECT body->>'lastMessageAt' AS at FROM backend_conversations WHERE id=$1", [conversation.id])).rows[0].at;
  assert.equal(after, expected);
});

// ---------------------------------------------------------------- C. the form fills the request

test("C: a form with a draft sends request.update (typed, known fields only) without the model", async (t) => {
  const h = await harness(t);
  const { conversation, card } = await h.withCard(h.user);
  await h.mandate(conversation.id);
  await h.send(h.user, conversation.id, form({ nombreEnfantsACharge: "2", profession: "Enseignante", inconnu: "x", adresseDomicile: "  ", situationMatrimoniale: null }));
  const seen = [];
  await h.process({ async generate(_config, history) { seen.push(history.at(-1).role); return final("Merci, c’est enregistré."); } }, conversation.id);
  const updates = h.called("request.update");
  assert.equal(updates.length, 1);
  assert.equal(updates[0].args.requestId, card.id);
  assert.deepEqual(updates[0].args.fields, [
    { name: "nombreEnfantsACharge", value: 2, source: "answer" },
    { name: "profession", value: "Enseignante", source: "answer" },
  ]);
  assert.equal(seen[0], "tool", "the model only comments the result");
  assert.ok(updates[0].context.mandateId);
  assert.equal((await h.lastBlocks(conversation.id)).some((block) => block.type === "requestCard"), true);
});

test("C: a form sent without a draft goes on to the model, then fills the request once it is created", async (t) => {
  const h = await harness(t);
  const conversation = await h.conversations.create(h.user, { locale: "fr" }, identifier("key"));
  await h.mandate(conversation.id);
  await h.send(h.user, conversation.id, form({ nombreEnfantsACharge: "3", profession: "Comptable" }));
  let turn = 0;
  const model = { async generate() { turn++; return turn === 1 ? toolCall("request.create", { procedureId: procedure.id }) : final("Votre dossier est à jour."); } };
  await h.process(model, conversation.id);
  assert.equal(h.calls[0].name, "request.create");
  const update = h.called("request.update")[0];
  assert.ok(update, "request.update was forced after the creation");
  assert.deepEqual(update.args.fields.map((field) => field.name), ["nombreEnfantsACharge", "profession"]);
  assert.equal(update.args.fields[0].value, 3, "the integer comes from the procedure schema read by the Backend");
  assert.equal(turn, 2);
});

test("C: a blocked update keeps the form values in pending_action and is replayed after consent", async (t) => {
  const h = await harness(t);
  const { conversation, card } = await h.withCard(h.user);
  await h.send(h.user, conversation.id, form({ nombreEnfantsACharge: "4", profession: "Maçon" }));
  const model = { async generate() { return final("Une autorisation est nécessaire."); } };
  await h.process(model, conversation.id);
  assert.equal(h.called("request.update").length, 0, "no mandate: nothing reached the Tooling");
  const waiting = await h.pending(conversation.id);
  assert.match(waiting.name, /request\.update$/);
  assert.equal(JSON.parse(waiting.arguments).requestId, card.id);
  assert.deepEqual(waiting.formValues, { nombreEnfantsACharge: "4", profession: "Maçon" });

  await h.mandate(conversation.id);
  await transaction(h.pool, (db) => h.conversations.enqueueResume(db, conversation.id, RESUME_AFTER_CONSENT));
  await h.process({ async generate() { return final("Enregistré."); } }, conversation.id);
  const updates = h.called("request.update");
  assert.equal(updates.length, 1, "replayed once, not forced a second time by the stored form values");
  assert.equal(updates[0].args.fields.find((field) => field.name === "nombreEnfantsACharge").value, 4);
  assert.equal(await h.pending(conversation.id), null);
});

test("C: the model sees why a correctable tool call failed, and nothing else about the failure", async (t) => {
  const h = await harness(t);
  const { conversation } = await h.withCard(h.user);
  await h.mandate(conversation.id);
  h.state.failUpdate = "nombreEnfantsACharge doit être un entier";
  await h.send(h.user, conversation.id, form({ nombreEnfantsACharge: "2" }));
  let toolTurn;
  await h.process({ async generate(_config, history) { toolTurn = history.findLast((turn) => turn.role === "tool"); return final("Je corrige."); } }, conversation.id);
  assert.match(toolTurn.content, /INVALID_REQUEST/);
  assert.match(toolTurn.content, /doit être un entier/);
  assert.equal(toolTurn.content.includes("traceId"), false);
});

// ---------------------------------------------------------------- D. payment confirmation

test("D: wanting to pay shows the amount and a button; the click pays once; another request stays blocked", async (t) => {
  const h = await harness(t);
  const { conversation, card } = await h.withCard(h.user);
  await h.mandate(conversation.id);
  const wantsToPay = { async generate(_config, history) { return history.some((turn) => turn.role === "tool") ? final("Le montant est de 1 000 FCFA. Confirmez pour payer.", [procedure.source]) : toolCall("request.pay", { requestId: card.id }); } };
  await h.send(h.user, conversation.id, { type: "text", text: "Je veux payer" });
  await h.process(wantsToPay, conversation.id);
  assert.equal(h.called("request.pay").length, 0);
  assert.equal(h.called("case.status").length, 1);
  const buttons = (await h.lastBlocks(conversation.id)).find((block) => block.type === "buttons");
  assert.deepEqual(buttons.items, [{ id: "payment.confirm." + card.id, label: "Confirmer 1 000 FCFA" }, { id: "payment.later." + card.id, label: "Plus tard" }]);
  assert.ok(buttons.items[0].label.length <= 24);

  await h.send(h.user, conversation.id, { type: "interaction", actionId: "payment.confirm." + card.id, value: null });
  await h.process({ async generate() { return final("Paiement effectué."); } }, conversation.id);
  assert.equal(h.called("request.pay").length, 1);
  assert.deepEqual(h.called("request.pay")[0].args, { requestId: card.id });

  // The confirmation covers its own request only: a model asking for another one is stopped.
  const other = "req_01JD0000000000000000000009";
  const { conversation: second } = await h.withCard(h.user);
  await h.mandate(second.id);
  await h.send(h.user, second.id, { type: "interaction", actionId: "payment.confirm." + card.id, value: null });
  let turn = 0;
  await h.process({ async generate() { turn++; return turn === 1 ? toolCall("request.pay", { requestId: other }) : final("Confirmez le paiement."); } }, second.id);
  assert.equal(h.called("request.pay").filter((entry) => entry.args.requestId === other).length, 0);
  const prompt = (await h.lastBlocks(second.id)).find((block) => block.type === "buttons");
  assert.equal(prompt.items[0].id, "payment.confirm." + other);
});

test("D: a case.updated published during the payment turn is not shown twice", async (t) => {
  const h = await harness(t);
  const { conversation, card } = await h.withCard(h.user);
  await h.mandate(conversation.id);
  const base = h.tooling.call;
  h.tooling.call = async (url, auth, name, args, context, key) => {
    const result = await base(url, auth, name, args, context, key);
    if (name === "request.pay") {
      const paid = { ...fixtures.schemas.Case, status: "in_review" };
      await h.conversations.ingest(envelope({ kind: "case.updated", conversationId: conversation.id, case: paid }, tp, "tooling"), identifier("key"));
    }
    return result;
  };
  await h.send(h.user, conversation.id, { type: "interaction", actionId: "payment.confirm." + card.id, value: null });
  await h.process({ async generate() { return final("Paiement effectué."); } }, conversation.id);
  assert.equal(h.called("request.pay").length, 1);
  const sent = (await h.pool.query("SELECT body->'data'->'message'->'blocks' AS blocks FROM backend_conversation_events WHERE conversation_id=$1 AND body->'data'->>'kind'='message.sent'", [conversation.id])).rows;
  const cards = sent.flatMap((row) => row.blocks).filter((block) => block.type === "caseCard" && block.case.id === fixtures.schemas.Case.id);
  assert.equal(cards.length, 1);
});

test("D: an unreadable amount leaves a generic confirmation button", async (t) => {
  const h = await harness(t);
  const { conversation, card } = await h.withCard(h.user);
  await h.mandate(conversation.id);
  h.state.statusFails = true;
  await h.send(h.user, conversation.id, { type: "text", text: "Je veux payer" });
  await h.process({ async generate(_config, history) { return history.some((turn) => turn.role === "tool") ? final("Confirmez pour payer.") : toolCall("request.pay", { requestId: card.id }); } }, conversation.id);
  assert.equal(h.called("request.pay").length, 0);
  assert.equal((await h.lastBlocks(conversation.id)).find((block) => block.type === "buttons").items[0].label, "Confirmer le paiement");
});

// ---------------------------------------------------------------- E. small fixes

test("E: one card per request and per case within a message, the latest state wins", async (t) => {
  const h = await harness(t);
  const { conversation, card } = await h.withCard(h.user);
  await h.mandate(conversation.id);
  await h.send(h.user, conversation.id, { type: "text", text: "Renseigner mon profil" });
  let turn = 0;
  const model = { async generate() {
    turn++;
    if (turn === 1) return { text: "", calls: [
      { id: "u1", name: "request.update", arguments: JSON.stringify({ requestId: card.id, fields: [{ name: "profession", value: "Maçon", source: "answer" }] }) },
      { id: "u2", name: "request.update", arguments: JSON.stringify({ requestId: card.id, fields: [{ name: "adresseDomicile", value: "Cotonou", source: "answer" }] }) },
    ] };
    return final("Dossier mis à jour.");
  } };
  await h.process(model, conversation.id);
  const blocks = await h.lastBlocks(conversation.id);
  const cards = blocks.filter((block) => block.type === "requestCard");
  assert.equal(cards.length, 1);
  assert.equal(cards[0].request.fields.find((field) => field.name === "adresseDomicile").value, "Cotonou");
  assert.equal(cards[0].request.fields.find((field) => field.name === "profession").value, "Maçon");
});

test("E: lastMessageAt follows the exchange in the conversation list", async (t) => {
  const h = await harness(t);
  const conversation = await h.conversations.create(h.user, { locale: "fr" }, identifier("key"));
  assert.equal((await h.conversations.list(h.user.userRef, 10)).items[0].lastMessageAt, null);
  await h.send(h.user, conversation.id, { type: "text", text: "Bonjour" });
  const received = (await h.conversations.list(h.user.userRef, 10)).items[0].lastMessageAt;
  assert.equal(typeof received, "string");
  await new Promise((resolve) => setTimeout(resolve, 5));
  await h.process({ async generate() { return final("Bonjour."); } }, conversation.id);
  const sent = (await h.conversations.list(h.user.userRef, 10)).items[0].lastMessageAt;
  assert.ok(Date.parse(sent) > Date.parse(received));
});

test("E: questions outside the administrative scope reach the unanswered list", async (t) => {
  const h = await harness(t);
  const conversation = await h.conversations.create(h.user, { locale: "fr" }, identifier("key"));
  const message = await h.send(h.user, conversation.id, { type: "text", text: "Quelle est la capitale de la France ?" });
  await h.process({ async generate() { return final("Je ne peux répondre qu’aux questions sur les démarches administratives."); } }, conversation.id);
  const rows = (await h.pool.query("SELECT reason FROM backend_unanswered WHERE conversation_id=$1 AND message_id=$2", [conversation.id, message.id])).rows;
  assert.deepEqual(rows.map((row) => row.reason), ["missing_source"]);
});

test("A: a refused generic reply is an invalid_reply when sources were observed, missing_source otherwise", async (t) => {
  const h = await harness(t);
  const conversation = await h.conversations.create(h.user, { locale: "fr" }, identifier("key"));
  const message = await h.send(h.user, conversation.id, { type: "text", text: "Dites-moi tout" });
  let turn = 0;
  await h.process({ async generate(_config, history) {
    turn++;
    if (!history.some((item) => item.role === "tool")) return toolCall("procedures.get", { procedureId: procedure.id });
    return final("Le tarif est de 1000 FCFA.", [{ procedureId: "PS99999", url: "https://autre.example/x" }]);
  } }, conversation.id);
  const rows = (await h.pool.query("SELECT reason FROM backend_unanswered WHERE conversation_id=$1 AND message_id=$2", [conversation.id, message.id])).rows;
  assert.deepEqual(rows.map((row) => row.reason), ["invalid_reply"]);
});

test("a model cannot produce the payment confirmation button", async () => {
  const { presentModelReply } = await import("../dist/apps/backend/src/model-reply.js");
  const evidence = { sources: [], requests: [] };
  const id = "payment.confirm.req_01HZZZZZZZZZZZZZZZZZZZZZZZ";
  const kept = presentModelReply(JSON.stringify({ blocks: [
    { type: "text", text: "Voici la suite.", sources: [] },
    { type: "buttons", items: [{ id, label: "Voir mon dossier" }, { id: "voir", label: "Voir" }] },
  ] }), evidence);
  assert.deepEqual(kept[1].items.map((item) => item.id), ["voir"]);
  const dropped = presentModelReply(JSON.stringify({ blocks: [
    { type: "text", text: "Voici la suite.", sources: [] },
    { type: "buttons", items: [{ id, label: "Voir mon dossier" }] },
  ] }), evidence);
  assert.equal(dropped.length, 1);
  assert.equal(dropped[0].type, "text");
});

test("cards copied by the model are dropped, and a reply made only of them is refused", async () => {
  const { presentModelReply, ModelReplyError } = await import("../dist/apps/backend/src/model-reply.js");
  const evidence = { sources: [], requests: [] };
  const card = { type: "requestCard", request: { id: "req_01HZZZZZZZZZZZZZZZZZZZZZZZ", status: "submitted" } };
  const kept = presentModelReply(JSON.stringify({ blocks: [{ type: "text", text: "Ajoutez votre pièce.", sources: [] }, card] }), evidence);
  assert.deepEqual(kept.map((block) => block.type), ["text"]);
  assert.throws(() => presentModelReply(JSON.stringify({ blocks: [card] }), evidence), (error) => error instanceof ModelReplyError && error.reason === "unsupported_block");
});

test("a model button over the label limit is dropped, the reply stays", async () => {
  const { presentModelReply } = await import("../dist/apps/backend/src/model-reply.js");
  const blocks = presentModelReply(JSON.stringify({ blocks: [
    { type: "text", text: "Le dossier attend votre paiement.", sources: [] },
    { type: "buttons", items: [{ id: "payer", label: "Confirmer le paiement de 1 900 FCFA" }] },
  ] }), { sources: [], requests: [] });
  assert.deepEqual(blocks.map((block) => block.type), ["text"]);
});

// ---------------------------------------------------------------- F. prepare button

const modelButtons = { type: "buttons", items: [{ id: "commencer", label: "Commencer la demande" }] };
/** A model that reads the fiche, then answers citing `sources` and offering its own button. */
const readsThenAnswers = (sources, extra = []) => ({
  async generate(_config, history) {
    if (!history.some((turn) => turn.role === "tool")) return toolCall("procedures.get", { procedureId: procedure.id });
    return { text: JSON.stringify({ blocks: [{ type: "text", text: "Voici les étapes de la démarche.", sources }, modelButtons, ...extra] }), calls: [] };
  },
});

test("F: a reply citing one filable procedure gets the prepare button, the model buttons are removed", async (t) => {
  const h = await harness(t);
  const conversation = await h.conversations.create(h.user, { locale: "fr" }, identifier("key"));
  await h.send(h.user, conversation.id, { type: "text", text: "Que faut-il pour le casier judiciaire ?" });
  await h.process(readsThenAnswers([procedure.source]), conversation.id);
  const buttons = (await h.lastBlocks(conversation.id)).filter((block) => block.type === "buttons");
  assert.equal(buttons.length, 1);
  assert.deepEqual(buttons[0].items, [{ id: "request.prepare." + procedure.id, label: "Préparer ma demande" }]);
});

test("F: a procedure without filing never gets the prepare button", async (t) => {
  const h = await harness(t);
  const withoutFiling = { ...procedure, filing: null };
  const base = h.tooling.call;
  h.tooling.call = async (url, auth, name, ...rest) => {
    if (name === "procedures.get") { const result = await base(url, auth, name, ...rest); return { ...result, structuredContent: withoutFiling }; }
    return base(url, auth, name, ...rest);
  };
  const conversation = await h.conversations.create(h.user, { locale: "fr" }, identifier("key"));
  await h.send(h.user, conversation.id, { type: "text", text: "Que faut-il pour le casier judiciaire ?" });
  await h.process(readsThenAnswers([procedure.source]), conversation.id);
  const blocks = await h.lastBlocks(conversation.id);
  assert.equal(blocks.some((block) => block.type === "text" && block.text === "Voici les étapes de la démarche."), true);
  assert.equal(blocks.some((block) => block.items?.some((item) => item.id.startsWith("request.prepare."))), false);
});

test("F: two procedures cited, no prepare button", async (t) => {
  const h = await harness(t);
  const other = { ...procedure, id: "PS00999", source: { ...procedure.source, procedureId: "PS00999", url: "https://service-public.bj/public/services/service/PS00999" } };
  const base = h.tooling.call;
  h.tooling.call = async (url, auth, name, args, ...rest) => {
    const result = await base(url, auth, name, args, ...rest);
    return name === "procedures.get" && args.procedureId === other.id ? { ...result, structuredContent: other } : result;
  };
  const conversation = await h.conversations.create(h.user, { locale: "fr" }, identifier("key"));
  await h.send(h.user, conversation.id, { type: "text", text: "Que faut-il pour le casier judiciaire ?" });
  let turn = 0;
  const model = { async generate() {
    turn++;
    if (turn === 1) return toolCall("procedures.get", { procedureId: procedure.id });
    if (turn === 2) return toolCall("procedures.get", { procedureId: other.id });
    return { text: JSON.stringify({ blocks: [{ type: "text", text: "Voici les étapes de ces démarches.", sources: [procedure.source, other.source] }] }), calls: [] };
  } };
  await h.process(model, conversation.id);
  const blocks = await h.lastBlocks(conversation.id);
  assert.equal(blocks.some((block) => block.type === "text" && block.sources.length === 2), true);
  assert.equal(blocks.some((block) => block.items?.some((item) => item.id.startsWith("request.prepare."))), false);
});

test("F: a draft already present, no prepare button", async (t) => {
  const h = await harness(t);
  const { conversation } = await h.withCard(h.user);
  await h.send(h.user, conversation.id, { type: "text", text: "Que faut-il pour le casier judiciaire ?" });
  await h.process(readsThenAnswers([procedure.source]), conversation.id);
  const blocks = await h.lastBlocks(conversation.id);
  assert.equal(blocks.some((block) => block.type === "text" && block.text === "Voici les étapes de la démarche."), true);
  assert.equal(blocks.some((block) => block.items?.some((item) => item.id.startsWith("request.prepare."))), false);
});

test("F: the click sends request.create once with that procedureId, without the model", async (t) => {
  const h = await harness(t);
  const conversation = await h.conversations.create(h.user, { locale: "fr" }, identifier("key"));
  await h.mandate(conversation.id);
  await h.send(h.user, conversation.id, { type: "interaction", actionId: "request.prepare." + procedure.id, value: null });
  await h.process({ async generate() { return final("Votre dossier est en préparation."); } }, conversation.id);
  assert.equal(h.called("request.create").length, 1);
  assert.deepEqual(h.called("request.create")[0].args, { procedureId: procedure.id });
});

test("F: a model cannot produce a request.prepare button", async () => {
  const dropped = presentModelReply(JSON.stringify({ blocks: [
    { type: "text", text: "Voici la suite.", sources: [] },
    { type: "buttons", items: [{ id: "request.prepare.PS00373", label: "Préparer" }] },
  ] }), empty);
  assert.deepEqual(dropped.map((block) => block.type), ["text"]);
});

test("a reply written after reading a fiche keeps its source, even without a stated fact", async () => {
  const { presentModelReply } = await import("../dist/apps/backend/src/model-reply.js");
  const source = { procedureId: "PS00373", url: "https://service-public.bj/fiche", retrievedAt: "2026-11-01T00:00:00.000Z" };
  const reply = (text) => JSON.stringify({ blocks: [{ type: "text", text, sources: [] }] });
  const evidence = { sources: [source], requests: [] };
  assert.deepEqual(presentModelReply(reply("Les documents à fournir incluent notamment un formulaire."), evidence)[0].sources, [source]);
  assert.deepEqual(presentModelReply(reply("Je n’ai pas trouvé de démarche validée."), evidence)[0].sources, []);
  assert.deepEqual(presentModelReply(reply("Les documents à fournir incluent notamment un formulaire."), { sources: [], requests: [] })[0].sources, []);
});

test("sources kept without a stated fact are limited to the latest fiche, and repeated ones are dropped", async () => {
  const { presentModelReply } = await import("../dist/apps/backend/src/model-reply.js");
  const a = { procedureId: "PS00373", url: "https://service-public.bj/a", retrievedAt: "2026-11-01T00:00:00.000Z" };
  const b = { procedureId: "PS00260", url: "https://service-public.bj/b", retrievedAt: "2026-11-01T00:00:00.000Z" };
  const reply = (text) => JSON.stringify({ blocks: [{ type: "text", text, sources: [] }] });
  const evidence = { sources: [a, b, a], requests: [] };
  assert.deepEqual(presentModelReply(reply("Connectez-vous pour continuer."), evidence)[0].sources, [a]);
  assert.deepEqual(presentModelReply(reply("Le coût est de 1 900 FCFA."), evidence)[0].sources, [a, b]);
});

test("a reply reporting the user's own cases may state an amount without a catalogue source", async () => {
  const { presentModelReply, ModelReplyError } = await import("../dist/apps/backend/src/model-reply.js");
  const reply = JSON.stringify({ blocks: [{ type: "text", text: "Votre demande attend le paiement de 1 900 FCFA.", sources: [] }] });
  assert.deepEqual(presentModelReply(reply, { sources: [], requests: [], connectorData: true })[0].sources, []);
  assert.throws(() => presentModelReply(reply, { sources: [], requests: [] }), (error) => error instanceof ModelReplyError && error.reason === "admin_fact_without_source");
});

// ---------------------------------------------------------------- G. guaranteed form and payment button

const formBlocks = (blocks) => blocks.filter((block) => block.type === "form");
const createsThen = (reply, before = []) => { let turn = 0; return { async generate() { turn++; return turn <= before.length ? before[turn - 1] : turn === before.length + 1 ? toolCall("request.create", { procedureId: procedure.id }) : reply; } }; };
const caseOf = (requestId, status, amountFcfa = 1900) => ({ ...fixtures.schemas.Case, id: identifier("cas"), requestId, status, payment: { ...fixtures.schemas.Case.payment, amountFcfa, status: status === "awaiting_payment" ? "pending" : "paid", reference: null, paidAt: null } });
/** Adds a later message carrying a case card to a conversation. */
async function addCaseMessage(h, conversation, owner, card) {
  const message = await h.send(owner, conversation.id, { type: "text", text: "Où en suis-je ?" });
  await transaction(h.pool, (db) => h.conversations.complete(db, conversation.id, message.id, [{ type: "text", text: "Voici l’état.", sources: [] }, { type: "caseCard", case: card }], tp));
}
const submitReturns = (h, value) => {
  const base = h.tooling.call;
  h.tooling.call = async (url, auth, name, ...rest) => {
    if (name === "request.submit") { await base(url, auth, name, ...rest); return { structuredContent: value, content: [{ type: "text", text: JSON.stringify(value) }] }; }
    return base(url, auth, name, ...rest);
  };
};

test("G: request.create with empty fields and a model without form gets the Backend form, typed from the schema", async (t) => {
  const h = await harness(t);
  const conversation = await h.conversations.create(h.user, { locale: "fr" }, identifier("key"));
  await h.mandate(conversation.id);
  await h.send(h.user, conversation.id, { type: "text", text: "Je veux déposer un casier judiciaire" });
  const lenient = { ...procedure, filing: { ...procedure.filing, formSchema: { ...procedure.filing.formSchema, required: ["profession"], properties: { ...procedure.filing.formSchema.properties, situationMatrimoniale: { type: "string", format: "date" } } } } };
  const base = h.tooling.call;
  h.tooling.call = async (url, auth, name, ...rest) => name === "procedures.get" ? (await base(url, auth, name, ...rest), { structuredContent: lenient, content: [{ type: "text", text: JSON.stringify(lenient) }] }) : base(url, auth, name, ...rest);
  await h.process(createsThen(final("Votre dossier est ouvert."), [toolCall("procedures.get", { procedureId: procedure.id })]), conversation.id);
  const blocks = await h.lastBlocks(conversation.id);
  const forms = formBlocks(blocks);
  assert.equal(forms.length, 1);
  const request = blocks.find((block) => block.type === "requestCard").request;
  assert.equal(forms[0].id, "request.form." + request.id);
  assert.deepEqual(forms[0].fields.map((field) => [field.name, field.required, field.type]), [
    ["adresseDomicile", false, "text"],
    ["profession", true, "text"],
    ["nombreEnfantsACharge", false, "number"],
    ["situationMatrimoniale", false, "date"],
  ]);
  assert.ok(blocks.findIndex((block) => block.type === "requestCard") < blocks.findIndex((block) => block.type === "form"), "the card comes before the form");
});

test("G: an unknown procedure in the turn gives text fields, all required", async (t) => {
  const h = await harness(t);
  const conversation = await h.conversations.create(h.user, { locale: "fr" }, identifier("key"));
  await h.mandate(conversation.id);
  await h.send(h.user, conversation.id, { type: "text", text: "Je veux déposer un casier judiciaire" });
  await h.process(createsThen(final("Votre dossier est ouvert.")), conversation.id);
  const forms = formBlocks(await h.lastBlocks(conversation.id));
  assert.equal(forms.length, 1);
  assert.equal(forms[0].fields.every((field) => field.required && field.type === "text"), true);
});

test("G: the model's own form is replaced by the Backend's, one form only", async (t) => {
  const h = await harness(t);
  const conversation = await h.conversations.create(h.user, { locale: "fr" }, identifier("key"));
  await h.mandate(conversation.id);
  await h.send(h.user, conversation.id, { type: "text", text: "Je veux déposer un casier judiciaire" });
  const own = { text: JSON.stringify({ blocks: [{ type: "text", text: "Remplissez ceci.", sources: [] }, { type: "form", id: "mon-formulaire", fields: [{ name: "x", label: "X", required: true, type: "text" }] }] }), calls: [] };
  await h.process(createsThen(own), conversation.id);
  const forms = formBlocks(await h.lastBlocks(conversation.id));
  assert.equal(forms.length, 1);
  assert.match(forms[0].id, /^request\.form\./);
  assert.equal(forms[0].fields.some((field) => field.name === "x"), false);
});

test("G: filled fields or a pending consent: no form", async (t) => {
  const h = await harness(t);
  const full = (cid) => draftOf(cid, undefined, { adresseDomicile: "Cotonou", profession: "Maçon", nombreEnfantsACharge: 1, situationMatrimoniale: "Marié" });
  const draftOf = h.draftOf;
  const conversation = await h.conversations.create(h.user, { locale: "fr" }, identifier("key"));
  await h.mandate(conversation.id);
  await h.send(h.user, conversation.id, { type: "text", text: "Je veux déposer un casier judiciaire" });
  const base = h.tooling.call;
  h.tooling.call = async (url, auth, name, args, context, ...rest) => name === "request.create" ? (await base(url, auth, name, args, context, ...rest), { structuredContent: full(context.conversationId), content: [{ type: "text", text: "{}" }] }) : base(url, auth, name, args, context, ...rest);
  await h.process(createsThen(final("Votre dossier est complet.")), conversation.id);
  assert.equal(formBlocks(await h.lastBlocks(conversation.id)).length, 0);

  // No mandate: the consent is pending, the request is never created, and the Backend adds no form.
  const guestless = await harness(t);
  const second = await guestless.conversations.create(guestless.user, { locale: "fr" }, identifier("key"));
  await guestless.send(guestless.user, second.id, { type: "text", text: "Je veux déposer un casier judiciaire" });
  await guestless.process(createsThen(final("Une autorisation est nécessaire.")), second.id);
  assert.equal(formBlocks(await guestless.lastBlocks(second.id)).length, 0);
});

test("G: sending the Backend's form forces request.update", async (t) => {
  const h = await harness(t);
  const conversation = await h.conversations.create(h.user, { locale: "fr" }, identifier("key"));
  await h.mandate(conversation.id);
  await h.send(h.user, conversation.id, { type: "text", text: "Je veux déposer un casier judiciaire" });
  await h.process(createsThen(final("Votre dossier est ouvert.")), conversation.id);
  const shown = await h.lastBlocks(conversation.id);
  const requestId = shown.find((block) => block.type === "requestCard").request.id;
  const { id } = shown.find((block) => block.type === "form");
  await h.pool.query("SELECT 1");
  await h.send(h.user, conversation.id, { type: "interaction", actionId: id, value: JSON.stringify({ profession: "Maçon", nombreEnfantsACharge: "3" }) });
  await h.process({ async generate() { return final("Merci, c’est enregistré."); } }, conversation.id);
  const update = h.called("request.update")[0];
  assert.equal(update.args.requestId, requestId);
  assert.deepEqual(update.args.fields.map((field) => field.name), ["profession", "nombreEnfantsACharge"]);
});

test("G: request.submit awaiting payment: the button comes with the filing message, request.pay is not called", async (t) => {
  const h = await harness(t);
  const { conversation, card } = await h.withCard(h.user);
  await h.mandate(conversation.id);
  submitReturns(h, caseOf(card.id, "awaiting_payment"));
  await h.send(h.user, conversation.id, { type: "text", text: "Dépose mon dossier" });
  let turn = 0;
  await h.process({ async generate() { turn++; return turn === 1 ? toolCall("request.submit", { requestId: card.id }) : final("Votre dossier est déposé."); } }, conversation.id);
  assert.equal(h.called("request.submit").length, 1);
  const buttons = (await h.lastBlocks(conversation.id)).filter((block) => block.type === "buttons");
  assert.equal(buttons.length, 1);
  assert.deepEqual(buttons[0].items, [{ id: "payment.confirm." + card.id, label: "Confirmer 1\u202f900\u00a0FCFA" }, { id: "payment.later." + card.id, label: "Plus tard" }]);
  assert.equal(h.called("request.pay").length, 0);
});

test("G: a case without payment due gets no button", async (t) => {
  const h = await harness(t);
  const { conversation, card } = await h.withCard(h.user);
  await h.mandate(conversation.id);
  submitReturns(h, caseOf(card.id, "in_review"));
  await h.send(h.user, conversation.id, { type: "text", text: "Dépose mon dossier" });
  let turn = 0;
  await h.process({ async generate() { turn++; return turn === 1 ? toolCall("request.submit", { requestId: card.id }) : final("Votre dossier est déposé."); } }, conversation.id);
  assert.equal((await h.lastBlocks(conversation.id)).some((block) => block.type === "buttons"), false);
});

test("G: wanting to pay with a case awaiting payment from an earlier message: button, nothing reaches request.pay", async (t) => {
  const h = await harness(t);
  const { conversation, card } = await h.withCard(h.user);
  await h.mandate(conversation.id);
  await addCaseMessage(h, conversation, h.user, caseOf(card.id, "awaiting_payment"));
  await h.send(h.user, conversation.id, { type: "text", text: "je veux payer" });
  await h.process({ async generate() { return final("Merci de confirmer votre souhait de payer."); } }, conversation.id);
  assert.equal(h.called("request.pay").length, 0, "the guard stops the forced call before the Tooling");
  const buttons = (await h.lastBlocks(conversation.id)).filter((block) => block.type === "buttons");
  assert.equal(buttons.length, 1);
  assert.deepEqual(buttons[0].items, [{ id: "payment.confirm." + card.id, label: "Confirmer 1\u202f000\u00a0FCFA" }, { id: "payment.later." + card.id, label: "Plus tard" }]);
});

test("G: a newer card of the same request with another status cancels the payable request", async (t) => {
  const h = await harness(t);
  const { conversation, card } = await h.withCard(h.user);
  await h.mandate(conversation.id);
  await addCaseMessage(h, conversation, h.user, caseOf(card.id, "awaiting_payment"));
  await addCaseMessage(h, conversation, h.user, caseOf(card.id, "in_review"));
  await h.send(h.user, conversation.id, { type: "text", text: "je veux payer" });
  await h.process({ async generate() { return final("Votre dossier est en cours d’examen."); } }, conversation.id);
  assert.equal(h.called("case.status").length, 0);
  assert.equal((await h.lastBlocks(conversation.id)).some((block) => block.type === "buttons"), false);
});

test("G: a case from another conversation never gets a payment button", async (t) => {
  const h = await harness(t);
  const { conversation } = await h.withCard(h.user);
  await h.mandate(conversation.id);
  const foreign = "req_01JD0000000000000000000077";
  await addCaseMessage(h, conversation, h.user, caseOf(foreign, "awaiting_payment"));
  await h.send(h.user, conversation.id, { type: "text", text: "je veux payer" });
  await h.process({ async generate() { return final("Je ne peux pas payer ici."); } }, conversation.id);
  assert.equal(h.called("request.pay").length, 0);
  assert.equal(h.called("case.status").length, 0);
  assert.equal((await h.lastBlocks(conversation.id)).some((block) => block.type === "buttons" && block.items.some((item) => item.id.startsWith("payment.confirm."))), false);

  // The card shown in the turn itself (such as a cases.list result) gets no button either.
  const { conversation: second, card } = await h.withCard(h.user);
  await h.mandate(second.id);
  submitReturns(h, caseOf(foreign, "awaiting_payment"));
  await h.send(h.user, second.id, { type: "text", text: "Dépose mon dossier" });
  let turn = 0;
  await h.process({ async generate() { turn++; return turn === 1 ? toolCall("request.submit", { requestId: card.id }) : final("Dossier déposé."); } }, second.id);
  assert.equal((await h.lastBlocks(second.id)).some((block) => block.type === "buttons"), false);
});

test("G: cases.list in the conversation of the request: payable here, so no nextStep and no pay-elsewhere text, usual button", async (t) => {
  const h = await harness(t);
  const { conversation, card } = await h.withCard(h.user);
  await h.mandate(conversation.id);
  await h.send(h.user, conversation.id, { type: "text", text: "Où en est ma demande ?" });
  const listCases = async () => ({ items: [{ ...caseOf(card.id, "awaiting_payment"), updatedAt: new Date().toISOString() }], nextCursor: null });
  let seen;
  const model = { async generate(_config, history) {
    const tool = history.findLast((item) => item.role === "tool");
    if (!tool) return toolCall("cases.list");
    seen = tool.content;
    return final("Votre dossier attend le paiement.");
  } };
  await new Agent(h.pool, h.conversations, model, h.tooling, undefined, undefined, listCases).process(conversation.id);
  assert.equal(seen.includes("nextStep"), false);
  const blocks = await h.lastBlocks(conversation.id);
  assert.equal(blocks.some((block) => block.type === "text" && block.text.startsWith("Pour payer, rouvrez")), false);
  assert.equal(blocks.some((block) => block.type === "buttons" && block.items.some((item) => item.id === "payment.confirm." + card.id)), true);
  assert.equal(h.called("request.pay").length, 0);
});

// ---------------------------------------------------------------- H. a file and the text that follows it

/** A conversation with one pending fileRequest; `h.tooling` answers documents.attach with the request and its document. */
async function fileScene(h, { request = true } = {}) {
  const conversation = await h.conversations.create(h.user, { locale: "fr" }, identifier("key"));
  const cid = conversation.id;
  const requestId = identifier("req");
  const fileId = identifier("fil");
  const file = { id: fileId, mimeType: "application/pdf", sizeBytes: 12, expiresAt: new Date(Date.now() + 3600000).toISOString() };
  await h.pool.query("INSERT INTO backend_files(id,user_ref,body,object_key,expires_at) VALUES($1,$2,$3,$4,$5)", [fileId, h.user.userRef, file, "synthetic-pdf", file.expiresAt]);
  if (request)
    await transaction(h.pool, (db) => h.conversations.complete(db, cid, identifier("msg"), [
      { type: "fileRequest", requestId, documentType: "extrait-acte-naissance", label: "Extrait d’acte de naissance", acceptedMimeTypes: ["application/pdf"], received: false },
    ], tp));
  await h.mandate(cid, h.user, ["documents:write"]);
  const attached = { ...fixtures.schemas.Request, id: requestId, conversationId: cid, documents: [{ documentType: "extrait-acte-naissance", label: "Extrait d’acte de naissance", fileId }] };
  const original = h.tooling.call;
  h.tooling.call = async (url, auth, name, args, context, key) => {
    const result = await original(url, auth, name, args, context, key);
    return name === "documents.attach" ? { structuredContent: attached, content: [{ type: "text", text: JSON.stringify(attached) }] } : result;
  };
  const sendAt = async (content, offsetMs = 0) => {
    const message = { id: identifier("msg"), content, sentAt: new Date(Date.now() + offsetMs).toISOString() };
    await h.conversations.accept(h.user, cid, message, identifier("key"), tp);
    return message;
  };
  const sendFile = () => sendAt({ type: "file", fileId, documentType: null });
  const seen = [];
  const model = { async generate(_config, history) { seen.push(history.filter((turn) => turn.role === "user").map((turn) => turn.content)); return final("Pièce rattachée."); } };
  const sentCount = async () => (await h.pool.query("SELECT count(*)::int AS n FROM backend_conversation_events WHERE conversation_id=$1 AND body->'data'->>'kind'='message.sent'", [cid])).rows[0].n;
  const processedAt = async (id) => (await h.pool.query("SELECT processed_at FROM backend_messages WHERE conversation_id=$1 AND id=$2", [cid, id])).rows[0].processed_at;
  return { cid, requestId, fileId, sendAt, sendFile, seen, model, sentCount, processedAt };
}

test("H: a file then its text already queued: one reply, one attach, the model sees the text, the text is processed", async (t) => {
  const h = await harness(t);
  const s = await fileScene(h);
  const before = await s.sentCount();
  await s.sendFile();
  const text = await s.sendAt({ type: "text", text: "Voici ma pièce" });
  await h.process(s.model, s.cid);
  assert.equal(await s.sentCount(), before + 1);
  assert.equal(h.called("documents.attach").length, 1);
  assert.equal(s.seen.length >= 1, true);
  const last = s.seen[0].at(-1);
  assert.match(last, new RegExp(s.fileId));
  assert.match(last, /Message joint par l’usager : Voici ma pièce/);
  assert.ok(await s.processedAt(text.id));
  assert.equal((await h.pool.query("SELECT count(*)::int AS n FROM backend_messages WHERE conversation_id=$1 AND processed_at IS NULL", [s.cid])).rows[0].n, 0);
});

test("H: a text arriving during the wait gives the same result", async (t) => {
  const h = await harness(t);
  const s = await fileScene(h);
  const before = await s.sentCount();
  await s.sendFile();
  const running = h.process(s.model, s.cid);
  await new Promise((resolve) => setTimeout(resolve, 300));
  const text = await s.sendAt({ type: "text", text: "Voici ma pièce" });
  await running;
  assert.equal(await s.sentCount(), before + 1);
  assert.equal(h.called("documents.attach").length, 1);
  assert.match(s.seen[0].at(-1), /Message joint par l’usager : Voici ma pièce/);
  assert.ok(await s.processedAt(text.id));
});

test("H: a file alone gets a normal turn", async (t) => {
  const h = await harness(t);
  const s = await fileScene(h);
  const before = await s.sentCount();
  const file = await s.sendFile();
  await h.process(s.model, s.cid);
  assert.equal(await s.sentCount(), before + 1);
  assert.equal(h.called("documents.attach").length, 1);
  assert.doesNotMatch(s.seen[0].at(-1), /Message joint/);
  assert.ok(await s.processedAt(file.id));
});

test("H: a text sent more than 5 seconds later keeps its own turn", async (t) => {
  const h = await harness(t);
  const s = await fileScene(h);
  const before = await s.sentCount();
  await s.sendFile();
  const text = await s.sendAt({ type: "text", text: "Voici ma pièce" }, 6000);
  await h.process(s.model, s.cid);
  assert.equal(await s.sentCount(), before + 2);
  assert.equal(h.called("documents.attach").length, 1);
  assert.doesNotMatch(s.seen[0].at(-1), /Message joint/);
  assert.ok(await s.processedAt(text.id));
});

test("H: a file answering no request is unchanged and takes no text", async (t) => {
  const h = await harness(t);
  const s = await fileScene(h, { request: false });
  const before = await s.sentCount();
  await s.sendFile();
  await s.sendAt({ type: "text", text: "Voici ma pièce" });
  await h.process(s.model, s.cid);
  assert.equal(await s.sentCount(), before + 2, "the file and the text each get their reply");
  assert.equal(h.called("documents.attach").length, 0);
  assert.equal(s.seen.flat().some((turn) => /Message joint/.test(turn)), false);
});

test("H: after an incident the text already marked processed is found again", async (t) => {
  const h = await harness(t);
  const s = await fileScene(h);
  const before = await s.sentCount();
  await s.sendFile();
  const text = await s.sendAt({ type: "text", text: "Voici ma pièce" });
  await h.pool.query("UPDATE backend_messages SET processed_at=now() WHERE conversation_id=$1 AND id=$2", [s.cid, text.id]);
  await h.process(s.model, s.cid);
  assert.equal(await s.sentCount(), before + 1);
  assert.match(s.seen[0].at(-1), /Message joint par l’usager : Voici ma pièce/);
});

// ---------------------------------------------------------------- I. end-to-end guidance

const askedToPay = (blocks) => blocks.find((block) => block.type === "text" && /Voulez-vous payer maintenant/.test(block.text));
/** request.update answers with a complete request (ready, nothing missing). */
const updatesToReady = (h) => {
  const base = h.tooling.call;
  h.tooling.call = async (url, auth, name, args, ...rest) => {
    const result = await base(url, auth, name, args, ...rest);
    if (name !== "request.update") return result;
    const request = { ...result.structuredContent, status: "ready", missing: [], fields: result.structuredContent.fields.map((field) => ({ ...field, value: field.value ?? "x" })) };
    return { structuredContent: request, content: [{ type: "text", text: JSON.stringify(request) }] };
  };
};
const completeForm = form({ adresseDomicile: "Cotonou", profession: "Maçon", nombreEnfantsACharge: "3", situationMatrimoniale: "Marié" });

test("I: a filing with fees asks the question first, offers confirm and later, and does not pay", async (t) => {
  const h = await harness(t);
  const { conversation, card } = await h.withCard(h.user);
  await h.mandate(conversation.id);
  submitReturns(h, caseOf(card.id, "awaiting_payment"));
  await h.send(h.user, conversation.id, { type: "text", text: "Dépose mon dossier" });
  let turn = 0;
  await h.process({ async generate() { turn++; return turn === 1 ? toolCall("request.submit", { requestId: card.id }) : final("Votre dossier est déposé."); } }, conversation.id);
  const blocks = await h.lastBlocks(conversation.id);
  assert.equal(askedToPay(blocks).text, "Il reste à payer 1 900 FCFA. Voulez-vous payer maintenant ?");
  assert.ok(blocks.indexOf(askedToPay(blocks)) < blocks.findIndex((block) => block.type === "buttons"), "the question comes before the buttons");
  assert.deepEqual(blocks.find((block) => block.type === "buttons").items.map((item) => item.id), ["payment.confirm." + card.id, "payment.later." + card.id]);
  assert.equal(h.called("request.pay").length, 0);
});

test("I: an amount too long for the button label keeps the question and gets the generic label", async (t) => {
  const h = await harness(t);
  const { conversation, card } = await h.withCard(h.user);
  await h.mandate(conversation.id);
  submitReturns(h, caseOf(card.id, "awaiting_payment", 123456789));
  await h.send(h.user, conversation.id, { type: "text", text: "Dépose mon dossier" });
  let turn = 0;
  await h.process({ async generate() { turn++; return turn === 1 ? toolCall("request.submit", { requestId: card.id }) : final("Votre dossier est déposé."); } }, conversation.id);
  const blocks = await h.lastBlocks(conversation.id);
  assert.match(askedToPay(blocks).text, /^Il reste à payer 123.456.789.FCFA\. Voulez-vous payer maintenant \?$/);
  assert.equal(blocks.find((block) => block.type === "buttons").items[0].label, "Confirmer le paiement");
});

test("I: the later click answers without the model and without paying; wanting to pay offers the choice again", async (t) => {
  const h = await harness(t);
  const { conversation, card } = await h.withCard(h.user);
  await h.mandate(conversation.id);
  await addCaseMessage(h, conversation, h.user, caseOf(card.id, "awaiting_payment"));
  await h.send(h.user, conversation.id, { type: "interaction", actionId: "payment.later." + card.id, value: null });
  await h.process({ async generate() { throw new Error("the model must not be called"); } }, conversation.id);
  assert.deepEqual(await h.lastBlocks(conversation.id), [{ type: "text", text: "D’accord, rien n’a été payé. Votre dossier reste en attente de paiement. Quand vous serez prêt, écrivez « je veux payer » dans cette conversation.", sources: [] }]);
  assert.equal(h.called("request.pay").length, 0);

  await h.send(h.user, conversation.id, { type: "text", text: "je veux payer" });
  await h.process({ async generate() { return final("Merci de confirmer votre souhait de payer."); } }, conversation.id);
  assert.equal(h.called("request.pay").length, 0);
  const buttons = (await h.lastBlocks(conversation.id)).find((block) => block.type === "buttons");
  assert.deepEqual(buttons.items.map((item) => item.id), ["payment.confirm." + card.id, "payment.later." + card.id]);
});

test("I: a ready request not filed at the end of the turn gets the question and the button; the click files once, then asks for payment", async (t) => {
  const h = await harness(t);
  const { conversation, card } = await h.withCard(h.user);
  await h.mandate(conversation.id);
  updatesToReady(h);
  await h.send(h.user, conversation.id, completeForm);
  await h.process({ async generate() { return final("Merci, c’est enregistré."); } }, conversation.id);
  const blocks = await h.lastBlocks(conversation.id);
  assert.ok(blocks.some((block) => block.type === "text" && block.text === "Votre dossier est complet. Voulez-vous le déposer ?"));
  assert.deepEqual(blocks.find((block) => block.type === "buttons").items, [{ id: "request.submit." + card.id, label: "Déposer mon dossier" }]);
  assert.equal(h.called("request.submit").length, 0);

  submitReturns(h, caseOf(card.id, "awaiting_payment"));
  await h.send(h.user, conversation.id, { type: "interaction", actionId: "request.submit." + card.id, value: null });
  await h.process({ async generate() { return final("Votre dossier est déposé."); } }, conversation.id);
  assert.equal(h.called("request.submit").length, 1);
  assert.deepEqual(h.called("request.submit")[0].args, { requestId: card.id });
  const after = await h.lastBlocks(conversation.id);
  assert.ok(askedToPay(after));
  assert.equal(after.some((block) => block.type === "buttons" && block.items.some((item) => item.id.startsWith("request.submit."))), false);
  assert.equal(h.called("request.pay").length, 0);
});

test("I: a ready request already filed in the turn gets no submit button", async (t) => {
  const h = await harness(t);
  const { conversation, card } = await h.withCard(h.user);
  await h.mandate(conversation.id);
  updatesToReady(h);
  submitReturns(h, caseOf(card.id, "in_review"));
  await h.send(h.user, conversation.id, completeForm);
  let turn = 0;
  await h.process({ async generate() { turn++; return turn === 1 ? toolCall("request.submit", { requestId: card.id }) : final("Votre dossier est déposé."); } }, conversation.id);
  assert.equal(h.called("request.update").length, 1);
  assert.equal(h.called("request.submit").length, 1);
  assert.equal((await h.lastBlocks(conversation.id)).some((block) => block.type === "buttons"), false);
});

test("I: a model cannot produce payment.later or request.submit buttons", () => {
  const dropped = presentModelReply(JSON.stringify({ blocks: [
    { type: "text", text: "Voici la suite.", sources: [] },
    { type: "buttons", items: [{ id: "payment.later.req_01HZ", label: "Plus tard" }, { id: "request.submit.req_01HZ", label: "Déposer" }] },
  ] }), empty);
  assert.deepEqual(dropped.map((block) => block.type), ["text"]);
});

test("I: a piece followed by a form answer is one turn: one reply, request.update and documents.attach once each, filing still possible", async (t) => {
  const h = await harness(t);
  const s = await fileScene(h);
  await h.mandate(s.cid);
  await transaction(h.pool, (db) => h.conversations.complete(db, s.cid, identifier("msg"), [{ type: "requestCard", request: h.draftOf(s.cid, s.requestId) }], tp));
  submitReturns(h, caseOf(s.requestId, "in_review"));
  const before = await s.sentCount();
  await s.sendFile();
  const answer = await s.sendAt(form({ profession: "Maçon" }));
  let turn = 0;
  await h.process({ async generate(_config, history) { s.seen.push(history.filter((item) => item.role === "user").map((item) => item.content)); turn++; return turn === 1 ? toolCall("request.submit", { requestId: s.requestId }) : final("Dossier déposé."); } }, s.cid);
  assert.equal(await s.sentCount(), before + 1);
  assert.equal(h.called("request.update").length, 1);
  assert.deepEqual(h.called("request.update")[0].args.fields.map((field) => field.name), ["profession"]);
  assert.equal(h.called("documents.attach").length, 1);
  assert.equal(h.called("request.submit").length, 1);
  assert.ok(h.calls.findIndex((entry) => entry.name === "request.update") < h.calls.findIndex((entry) => entry.name === "documents.attach"), "the form goes before the piece");
  assert.match(s.seen[0].at(-1), new RegExp(s.fileId));
  assert.ok(await s.processedAt(answer.id));
});

test("I: a piece followed by an interaction without JSON value keeps its own turn", async (t) => {
  const h = await harness(t);
  const s = await fileScene(h);
  const before = await s.sentCount();
  await s.sendFile();
  const click = await s.sendAt({ type: "interaction", actionId: "choix-libre", value: null });
  await h.process(s.model, s.cid);
  assert.equal(await s.sentCount(), before + 2);
  assert.equal(h.called("documents.attach").length, 1);
  assert.equal(h.called("request.update").length, 0);
  assert.ok(await s.processedAt(click.id));
});

// ---------------------------------------------------------------- G. non-fileable procedures

const sheetOf = (id, filing) => ({ ...procedure, id, filing, source: { ...procedure.source, procedureId: id, url: "https://service-public.bj/public/services/service/" + id } });
const infoOnly = sheetOf("PS00701", null);
const fileable = sheetOf("PS00702", procedure.filing);

/** The catalogue returns these hits, in this order, for any search. */
const searchReturns = (h, hits) => {
  const base = h.tooling.call;
  h.tooling.call = async (url, auth, name, args, ...rest) => {
    const result = await base(url, auth, name, args, ...rest);
    if (name === "procedures.search") return { ...result, structuredContent: { items: hits, nextCursor: null }, content: [{ type: "text", text: "{}" }] };
    if (name === "procedures.get") { const hit = hits.find((item) => item.id === args.procedureId); return hit ? { ...result, structuredContent: hit } : result; }
    return result;
  };
};
/** Searches, then answers with the given text and sources. */
const searchesThen = (text, sources) => {
  let turn = 0;
  return { async generate() {
    turn++;
    return turn === 1 ? toolCall("procedures.search", { query: "démarche" }) : { text: JSON.stringify({ blocks: [{ type: "text", text, sources }] }), calls: [] };
  } };
};
const askAs = async (h, owner, text) => {
  const conversation = await h.conversations.create(owner, { locale: "fr" }, identifier("key"));
  await h.send(owner, conversation.id, { type: "text", text });
  return conversation.id;
};
const noDeadEnd = (h, blocks) => {
  assert.equal(blocks.some((block) => block.type === "loginRequired"), false);
  assert.equal(blocks.some((block) => block.type === "consent"), false);
  assert.equal(h.called("request.create").length, 0);
};

test("G: a guest asking for a procedure without filing is not sent to sign in", async (t) => {
  const h = await harness(t);
  searchReturns(h, [infoOnly]);
  const cid = await askAs(h, h.guest, "Je veux faire mon passeport");
  await h.process(searchesThen("Voici la fiche du passeport.", [infoOnly.source]), cid);
  const blocks = await h.lastBlocks(cid);
  noDeadEnd(h, blocks);
  assert.equal(blocks.some((block) => block.items?.some((item) => item.id.startsWith("request.prepare."))), false);
});

test("G: the reply cites the procedure asked for, not the fileable neighbour", async (t) => {
  const h = await harness(t);
  searchReturns(h, [infoOnly, fileable]);
  const cid = await askAs(h, h.guest, "Je veux obtenir un acte de décès");
  await h.process(searchesThen("Voici la fiche de l’acte de décès.", [infoOnly.source]), cid);
  noDeadEnd(h, await h.lastBlocks(cid));
});

test("G: no matching sheet, the honest sentence, no source and no sign-in", async (t) => {
  const h = await harness(t);
  searchReturns(h, [infoOnly, fileable]);
  const cid = await askAs(h, h.guest, "Je veux obtenir un acte de décès");
  const sentence = "Je n’ai pas trouvé de démarche validée pour cette demande.";
  await h.process(searchesThen(sentence, []), cid);
  const blocks = await h.lastBlocks(cid);
  noDeadEnd(h, blocks);
  const text = blocks.find((block) => block.type === "text");
  assert.ok(text);
  assert.deepEqual(text.sources, []);
});

test("G: a guest asking for the single fileable procedure cited still gets the login card", async (t) => {
  const h = await harness(t);
  searchReturns(h, [fileable]);
  const cid = await askAs(h, h.guest, "Je veux faire mon casier judiciaire");
  await h.process(searchesThen("Voici la démarche.", [fileable.source]), cid);
  assert.equal((await h.lastBlocks(cid)).some((block) => block.type === "loginRequired"), true);
  assert.equal(h.called("request.create").length, 0);
});

for (const [label, owner] of [["guest", "guest"], ["signed in", "user"]]) {
  test("G: the model creating a request on a procedure without filing gets NOT_ASSISTED (" + label + ")", async (t) => {
    const h = await harness(t);
    searchReturns(h, [infoOnly]);
    const cid = await askAs(h, h[owner], "Parlez-moi du passeport");
    let turn = 0;
    let seen;
    const model = { async generate(_config, history) {
      turn++;
      if (turn === 1) return toolCall("procedures.search", { query: "passeport" });
      if (turn === 2) return toolCall("request.create", { procedureId: infoOnly.id });
      seen = history.filter((entry) => entry.role === "tool").at(-1)?.content;
      return { text: JSON.stringify({ blocks: [{ type: "text", text: "Voici la fiche.", sources: [infoOnly.source] }] }), calls: [] };
    } };
    await h.process(model, cid);
    noDeadEnd(h, await h.lastBlocks(cid));
    assert.match(JSON.stringify(seen), /NOT_ASSISTED/);
  });
}

for (const [label, owner] of [["guest", "guest"], ["signed in", "user"]]) {
  test("G: the forced procedures.get targets the first search hit (" + label + ")", async (t) => {
    const h = await harness(t);
    searchReturns(h, [infoOnly, fileable]);
    const cid = await askAs(h, h[owner], "Quels documents faut-il pour un acte de décès ?");
    await h.process(searchesThen("Voici la fiche.", [infoOnly.source]), cid);
    assert.equal(h.called("procedures.get")[0]?.args.procedureId, infoOnly.id);
  });
}

// ---------------------------------------------------------------- H. sources inferred, none cited

const fact = "Les frais sont de 1000 FCFA.";
const searchesThenUncited = (text) => {
  let turn = 0;
  return { async generate() {
    turn++;
    return turn === 1 ? toolCall("procedures.search", { query: "démarche" }) : { text: JSON.stringify({ blocks: [{ type: "text", text }] }), calls: [] };
  } };
};
const prepareButtons = (blocks) => blocks.flatMap((block) => block.items ?? []).filter((item) => item.id.startsWith("request.prepare."));

test("H: guest, uncited reply, top hit fileable: the login card still appears", async (t) => {
  const h = await harness(t);
  searchReturns(h, [fileable, infoOnly]);
  const cid = await askAs(h, h.guest, "Je veux déposer un casier judiciaire");
  await h.process(searchesThenUncited(fact), cid);
  assert.equal((await h.lastBlocks(cid)).some((block) => block.type === "loginRequired"), true);
  assert.equal(h.called("request.create").length, 0);
});

test("H: signed in, uncited reply, top hit fileable: the prepare button targets it", async (t) => {
  const h = await harness(t);
  searchReturns(h, [fileable, infoOnly]);
  const cid = await askAs(h, h.user, "Je veux déposer un casier judiciaire");
  await h.process(searchesThenUncited(fact), cid);
  assert.deepEqual(prepareButtons(await h.lastBlocks(cid)).map((item) => item.id), ["request.prepare." + fileable.id]);
});

for (const owner of ["guest", "user"]) {
  test("H: uncited reply, top hit without filing: no prepare button, no login card (" + owner + ")", async (t) => {
    const h = await harness(t);
    searchReturns(h, [infoOnly, fileable]);
    const cid = await askAs(h, h[owner], "Je veux déposer un casier judiciaire");
    await h.process(searchesThenUncited(fact), cid);
    const blocks = await h.lastBlocks(cid);
    assert.equal(prepareButtons(blocks).length, 0);
    noDeadEnd(h, blocks);
  });
}
