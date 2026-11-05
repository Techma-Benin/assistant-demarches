import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isolatedDatabase } from "./helpers.mjs";
import { database, migrate, provision } from "../dist/apps/backend/src/database.js";
import { Conversations, RESUME_AFTER_CONSENT, RESUME_AFTER_LOGIN } from "../dist/apps/backend/src/conversations.js";
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
  assert.deepEqual(buttons.items, [{ id: "payment.confirm." + card.id, label: "Confirmer 1 000 FCFA" }]);
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
