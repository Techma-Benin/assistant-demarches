import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import { generateKeyPair, exportJWK, createLocalJWKSet, decodeJwt, SignJWT } from "jose";
import { isolatedDatabase } from "./helpers.mjs";
import { database, migrate, provision } from "../dist/apps/backend/src/database.js";
import { createBackend } from "../dist/apps/backend/src/app.js";
import { Conversations, RESUME_AFTER_LOGIN } from "../dist/apps/backend/src/conversations.js";
import { Identities } from "../dist/apps/backend/src/identity.js";
import { Agent, needsCaseList, CASES_LIST_TOOL } from "../dist/apps/backend/src/agent.js";
import { transaction } from "../dist/apps/backend/src/transactions.js";
import { identifier } from "../dist/apps/backend/src/domain.js";

const fixtures = JSON.parse(readFileSync(new URL("../../../contracts/v2/examples.json", import.meta.url)));
const tp = "00-" + "7".repeat(32) + "-" + "6".repeat(16) + "-01";
const NPI = "0123456789012";
const OTHER_NPI = "9876543210987";
const final = (text) => ({ text: JSON.stringify({ blocks: [{ type: "text", text, sources: [] }] }), calls: [] });
const toolCall = (name, args = {}) => ({ text: "", calls: [{ id: "call-1", name, arguments: JSON.stringify(args) }] });
const caseAt = (n, updatedAt) => ({
  ...fixtures.schemas.Case,
  id: "cas_01JD00000000000000000000" + String(10 + n),
  reference: "SIM-ACJ-2026-0000" + String(10 + n),
  title: "Demande " + n,
  updatedAt,
});

test("simulated NPI login: routes, identity, attach and cases.list", async (t) => {
  const pg = await isolatedDatabase();
  const pool = database(pg.connection);
  const previousSwitch = process.env.NPI_SIMULATED_LOGIN;
  t.after(async () => {
    if (previousSwitch === undefined) delete process.env.NPI_SIMULATED_LOGIN;
    else process.env.NPI_SIMULATED_LOGIN = previousSwitch;
    await pool.end();
    await pg.close();
  });
  await migrate(pool);
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const kid = "npi-test";
  const guestIssuer = "https://backend.example.test/npi";
  const keycloakIssuer = "https://identity.example.test/realms/techma";
  const localKeys = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid, alg: "RS256" }] });
  // Like main.ts: Keycloak tokens and Backend-signed tokens are verified against different issuers.
  const auth = { issuer: keycloakIssuer, audience: "techma-backend", key: localKeys, guestIssuer, guestKey: localKeys };
  const keycloakCitizen = new SignJWT({ scope: "citizen" })
    .setProtectedHeader({ alg: "RS256", kid })
    .setSubject("keycloak-citizen")
    .setIssuer(keycloakIssuer)
    .setAudience("techma-backend")
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(privateKey);
  const signing = { key: privateKey, kid, issuer: guestIssuer };
  const npiSubjectKey = createHmac("sha256", "synthetic-pem").update("npi-subject").digest();
  const conversations = new Conversations(pool);
  const identities = new Identities(pool);
  let casePages = [];
  const listed = [];
  const listCases = async (userRef) => {
    listed.push(userRef);
    return casePages.shift() ?? { items: [], nextCursor: null };
  };
  const runtime = { pool, auth, identities, conversations, signing, npiSubjectKey };
  const app = await createBackend({ pool, auth, allowedMcpUrls: new Set(), runtime });
  t.after(() => app.close());
  await app.listen(0, "127.0.0.1");
  const base = await app.getUrl();
  await provision(pool, "global", "models", {
    id: "main",
    label: "Test",
    baseUrl: "http://127.0.0.1:9/v1",
    protocol: "chat-completions",
    model: "test-model",
    apiKeyRef: "TEST_KEY",
    temperature: 0,
    active: true,
  });
  const request = async (path, { method = "GET", body, bearer } = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: {
        ...(bearer ? { Authorization: "Bearer " + bearer } : {}),
        traceparent: tp,
        "Idempotency-Key": identifier("key").slice(0, 32),
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    return { status: res.status, value: text ? JSON.parse(text) : null, text };
  };
  const login = async (npi, code = "123456") => {
    const challenge = await request("/v1/identity/npi", { method: "POST", body: { npi } });
    assert.equal(challenge.status, 201, challenge.text);
    const session = await request("/v1/identity/npi/verify", { method: "POST", body: { challengeToken: challenge.value.challengeToken, code } });
    assert.equal(session.status, 200, session.text);
    return { challenge: challenge.value, session: session.value };
  };
  const userRefOf = async (token) => {
    const created = await request("/v1/conversations", { method: "POST", body: { locale: "fr" }, bearer: token });
    assert.equal(created.status, 201, created.text);
    return (await pool.query("SELECT user_ref FROM backend_conversations WHERE id=$1", [created.value.id])).rows[0].user_ref;
  };
  const lastBlocks = async (cid) =>
    (await pool.query(
      "SELECT body->'data'->'message'->'blocks' AS blocks FROM backend_conversation_events WHERE conversation_id=$1 AND body->'data'->>'kind'='message.sent' ORDER BY seq DESC LIMIT 1",
      [cid],
    )).rows[0]?.blocks ?? [];

  await t.test("without the option both routes answer 404", async () => {
    delete process.env.NPI_SIMULATED_LOGIN;
    const challenge = await request("/v1/identity/npi", { method: "POST", body: { npi: NPI } });
    assert.equal(challenge.status, 404);
    assert.equal(challenge.value.code, "NOT_FOUND");
    const verify = await request("/v1/identity/npi/verify", { method: "POST", body: { challengeToken: "x", code: "1" } });
    assert.equal(verify.status, 404);
    process.env.NPI_SIMULATED_LOGIN = "off";
    assert.equal((await request("/v1/identity/npi", { method: "POST", body: { npi: NPI } })).status, 404);
  });

  process.env.NPI_SIMULATED_LOGIN = "on";

  await t.test("challenge then verify gives a signed-in citizen session", async () => {
    const { challenge, session } = await login(NPI, "000000");
    assert.equal(challenge.simulated, true);
    assert.equal(session.simulated, true);
    assert.ok(Date.parse(challenge.expiresAt) - Date.now() <= 300_000 + 5000);
    assert.ok(Date.parse(session.expiresAt) - Date.now() > 11 * 3_600_000);
    const claims = decodeJwt(session.token);
    assert.equal(claims.token_use, "npi");
    assert.equal(claims.scope, "citizen");
    assert.equal((await request("/v1/conversations", { bearer: session.token })).status, 200);
    const resolved = await identities.resolve(claims);
    assert.equal(resolved.authenticated, true);
    // A Keycloak citizen token keeps working.
    assert.equal((await request("/v1/conversations", { bearer: await keycloakCitizen })).status, 200);
  });

  await t.test("the same NPI gives the same userRef, another NPI another one", async () => {
    const first = await userRefOf((await login(NPI)).session.token);
    const second = await userRefOf((await login(NPI, "999")).session.token);
    const other = await userRefOf((await login(OTHER_NPI)).session.token);
    assert.equal(first, second);
    assert.notEqual(first, other);
    assert.match(first, /^usr_/);
  });

  await t.test("the NPI appears neither in the challenge token nor in backend_identities", async () => {
    const { challenge, session } = await login(NPI);
    const claims = decodeJwt(challenge.challengeToken);
    assert.equal(claims.token_use, "npi_challenge");
    assert.equal(claims.sub, createHmac("sha256", npiSubjectKey).update(NPI).digest("hex"));
    for (const token of [challenge.challengeToken, session.token]) {
      const [, payload] = token.split(".");
      assert.equal(Buffer.from(payload, "base64url").toString().includes(NPI), false);
      assert.equal(JSON.stringify(decodeJwt(token)).includes(NPI), false);
    }
    await userRefOf(session.token);
    const rows = (await pool.query("SELECT * FROM backend_identities")).rows;
    assert.ok(rows.length > 0);
    assert.equal(JSON.stringify(rows).includes(NPI), false);
    assert.equal(JSON.stringify(rows).includes(claims.sub), false, "even the keyed digest is not stored as such");
  });

  await t.test("a challenge token is not a session, a guest token is not a challenge, an expired challenge is refused", async () => {
    const { challenge } = await login(NPI);
    const asBearer = await request("/v1/conversations", { bearer: challenge.challengeToken });
    assert.equal(asBearer.status, 403);
    const guest = await request("/v1/guest-sessions", { method: "POST" });
    assert.equal(guest.status, 201);
    const withGuest = await request("/v1/identity/npi/verify", { method: "POST", body: { challengeToken: guest.value.token, code: "123456" } });
    assert.equal(withGuest.status, 401);
    const expired = await new SignJWT({ token_use: "npi_challenge" })
      .setProtectedHeader({ alg: "RS256", kid })
      .setIssuer(guestIssuer)
      .setAudience("techma-backend")
      .setSubject("a".repeat(64))
      .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
      .sign(privateKey);
    const late = await request("/v1/identity/npi/verify", { method: "POST", body: { challengeToken: expired, code: "123456" } });
    assert.equal(late.status, 401);
    const session = (await login(NPI)).session.token;
    const sessionAsChallenge = await request("/v1/identity/npi/verify", { method: "POST", body: { challengeToken: session, code: "123456" } });
    assert.equal(sessionAsChallenge.status, 401);
  });

  await t.test("non numeric or malformed input answers 400", async () => {
    for (const body of [{ npi: "12ab" }, { npi: "" }, { npi: "1".repeat(21) }, { npi: 123 }, {}, { npi: NPI, extra: 1 }])
      assert.equal((await request("/v1/identity/npi", { method: "POST", body })).status, 400, JSON.stringify(body));
    const { challenge } = await login(NPI);
    for (const body of [{ challengeToken: challenge.challengeToken, code: "12ab" }, { challengeToken: challenge.challengeToken, code: "" }, { challengeToken: challenge.challengeToken, code: "1".repeat(13) }, { code: "123456" }, { challengeToken: challenge.challengeToken }])
      assert.equal((await request("/v1/identity/npi/verify", { method: "POST", body })).status, 400, JSON.stringify(body));
  });

  await t.test("a guest conversation attaches with the NPI token and its login resume is queued", async () => {
    const guest = await request("/v1/guest-sessions", { method: "POST" });
    const guestToken = guest.value.token;
    const created = await request("/v1/conversations", { method: "POST", body: { locale: "fr" }, bearer: guestToken });
    const cid = created.value.id;
    const guestRef = (await pool.query("SELECT user_ref FROM backend_conversations WHERE id=$1", [cid])).rows[0].user_ref;
    const asker = { userRef: guestRef, channel: "web", authenticated: false, expiresAt: Date.now() + 60000, roles: new Set() };
    const message = { id: identifier("msg"), content: { type: "text", text: "Où en est ma demande ?" }, sentAt: new Date().toISOString() };
    await conversations.accept(asker, cid, message, identifier("key"), tp);
    await transaction(pool, (db) => conversations.complete(db, cid, message.id, [{ type: "text", text: "Connectez-vous.", sources: [] }, { type: "loginRequired", reason: "Connexion requise." }], tp));
    const { session } = await login(NPI);
    const attached = await request("/v1/conversations/" + cid + "/attach", { method: "POST", body: { guestToken }, bearer: session.token });
    assert.equal(attached.status, 200, attached.text);
    const owner = (await pool.query("SELECT user_ref FROM backend_conversations WHERE id=$1", [cid])).rows[0].user_ref;
    assert.equal(owner, await userRefOf(session.token));
    const resumes = (await pool.query("SELECT processed_at FROM backend_messages WHERE conversation_id=$1 AND body->'content'->>'text'=$2", [cid, RESUME_AFTER_LOGIN])).rows;
    assert.equal(resumes.length, 1);
    assert.equal(resumes[0].processed_at, null);
  });

  const agentWith = (model, withCases = true) =>
    new Agent(pool, conversations, model, { async discover() { return []; }, async call() { throw new Error("no MCP tool here"); } }, undefined, undefined, withCases ? listCases : undefined);
  const newChat = async (token, text) => {
    const created = await request("/v1/conversations", { method: "POST", body: { locale: "fr" }, bearer: token });
    const cid = created.value.id;
    const userRef = (await pool.query("SELECT user_ref FROM backend_conversations WHERE id=$1", [cid])).rows[0].user_ref;
    const asker = { userRef, channel: "web", authenticated: !decodeJwt(token).token_use?.startsWith("guest"), expiresAt: Date.now() + 60000, roles: new Set() };
    const message = { id: identifier("msg"), content: { type: "text", text }, sentAt: new Date().toISOString() };
    await conversations.accept(asker, cid, message, identifier("key"), tp);
    return { cid, userRef };
  };

  await t.test("cases.list for a signed-in user: cards for the latest three and a short summary", async () => {
    listed.length = 0;
    casePages = [{
      items: [
        caseAt(1, "2026-11-01T10:00:00Z"),
        caseAt(2, "2026-11-04T10:00:00Z"),
        caseAt(3, "2026-11-03T10:00:00Z"),
        caseAt(4, "2026-11-02T10:00:00Z"),
      ],
      nextCursor: null,
    }];
    const { session } = await login(NPI);
    const { cid, userRef } = await newChat(session.token, "Bonjour, je voudrais un point");
    let turn = 0;
    let seen;
    const model = { async generate(_config, history, tools) {
      turn += 1;
      if (turn === 1) {
        assert.ok(tools.some((tool) => tool.name === "cases.list"));
        return toolCall("cases.list");
      }
      seen = history.findLast((item) => item.role === "tool").content;
      return final("Voici vos demandes.");
    } };
    await agentWith(model).process(cid);
    assert.deepEqual(listed, [userRef]);
    const cards = (await lastBlocks(cid)).filter((block) => block.type === "caseCard");
    assert.deepEqual(cards.map((block) => block.case.reference).sort(), ["SIM-ACJ-2026-000012", "SIM-ACJ-2026-000013", "SIM-ACJ-2026-000014"]);
    const summary = JSON.parse(seen);
    assert.equal(summary.isError, false);
    assert.equal(summary.result.total, 4);
    assert.equal(summary.result.cases.length, 3);
    assert.deepEqual(Object.keys(summary.result.cases[0]).sort(), ["payment", "reference", "status", "title", "updatedAt"]);
    assert.equal(seen.includes(userRef), false);
    assert.equal(summary.result.cases[0].reference, "SIM-ACJ-2026-000012", "the reference reaches the model readable, latest update first");
    const stored = (await pool.query("SELECT tool_name FROM backend_tool_results WHERE conversation_id=$1", [cid])).rows;
    assert.deepEqual(stored.map((row) => row.tool_name), ["cases.list"]);
    const called = (await pool.query("SELECT body->'data' AS data FROM backend_conversation_events WHERE conversation_id=$1 AND body->'data'->>'kind'='tool.called'", [cid])).rows;
    assert.equal(called.length, 1);
    assert.equal(called[0].data.toolName, "cases.list");
    assert.equal(called[0].data.outcome, "success");
  });

  await t.test("cases.list: a guest gets loginRequired, the call waits, then it is replayed after the NPI login", async () => {
    listed.length = 0;
    casePages = [{ items: [caseAt(5, "2026-11-04T09:00:00Z")], nextCursor: null }];
    const guest = await request("/v1/guest-sessions", { method: "POST" });
    const { cid } = await newChat(guest.value.token, "Où en est ma demande ?");
    // The question forces cases.list; the guest is stopped before X-Road. The model then explains.
    let turn = 0;
    const explain = { async generate(_config, history) {
      turn += 1;
      const last = history.findLast((item) => item.role === "tool");
      if (last) assert.match(last.content, /LOGIN_REQUIRED/);
      return final("Connectez-vous pour voir vos demandes.");
    } };
    await agentWith(explain).process(cid);
    assert.equal(turn, 1);
    assert.equal(listed.length, 0, "no X-Road call for a guest");
    const blocks = await lastBlocks(cid);
    assert.match(blocks.find((block) => block.type === "loginRequired").reason, /demandes/);
    const pending = (await pool.query("SELECT pending_action FROM backend_conversations WHERE id=$1", [cid])).rows[0].pending_action;
    assert.equal(pending.name, "cases.list");

    const { session } = await login(NPI);
    const attached = await request("/v1/conversations/" + cid + "/attach", { method: "POST", body: { guestToken: guest.value.token }, bearer: session.token });
    assert.equal(attached.status, 200, attached.text);
    const owner = (await pool.query("SELECT user_ref FROM backend_conversations WHERE id=$1", [cid])).rows[0].user_ref;
    let replayTurn = 0;
    const after = { async generate() { replayTurn += 1; return final("Voici l’état de votre demande."); } };
    await agentWith(after).process(cid);
    assert.deepEqual(listed, [owner]);
    assert.equal(replayTurn, 1);
    assert.equal((await lastBlocks(cid)).filter((block) => block.type === "caseCard").length, 1);
    assert.equal((await pool.query("SELECT pending_action FROM backend_conversations WHERE id=$1", [cid])).rows[0].pending_action, null);
  });

  await t.test("cases.list with no case, and with items that are not full cases", async () => {
    listed.length = 0;
    casePages = [{ items: [], nextCursor: null }];
    const { session } = await login(OTHER_NPI);
    const { cid } = await newChat(session.token, "Bonjour");
    let turn = 0;
    let seen;
    const model = { async generate(_config, history) {
      turn += 1;
      if (turn === 1) return toolCall("cases.list");
      seen = history.findLast((item) => item.role === "tool").content;
      return final("Vous n’avez aucune demande.");
    } };
    await agentWith(model).process(cid);
    assert.equal(JSON.parse(seen).result.total, 0);
    assert.equal((await lastBlocks(cid)).some((block) => block.type === "caseCard"), false);

    casePages = [{ items: [{ id: "cas_x", reference: "SIM-ACJ-2026-000001", status: "submitted" }], nextCursor: null }];
    const second = await newChat(session.token, "Bonjour encore");
    turn = 0;
    await agentWith(model).process(second.cid);
    assert.equal(JSON.parse(seen).result.total, 0, "a partial item is neither summarised nor turned into a card");
    assert.equal((await lastBlocks(second.cid)).some((block) => block.type === "caseCard"), false);
  });

  await t.test("the question forces cases.list; the tool is advertised only with its dependency", async () => {
    for (const phrase of ["Où en est ma demande ?", "Quel est le statut de ma demande", "Voir mes demandes", "Mon dossier en est où ?"])
      assert.equal(needsCaseList(phrase), true, phrase);
    for (const phrase of ["Quels documents pour un passeport ?", "Bonjour", "Je veux déposer une demande"])
      assert.equal(needsCaseList(phrase), false, phrase);

    listed.length = 0;
    casePages = [{ items: [caseAt(6, "2026-11-04T08:00:00Z")], nextCursor: null }];
    const { session } = await login(NPI);
    const { cid } = await newChat(session.token, "Où en est ma demande ?");
    let turn = 0;
    const model = { async generate(_config, history, tools) {
      turn += 1;
      assert.ok(tools.some((tool) => tool.name === CASES_LIST_TOOL.name));
      assert.ok(history.some((item) => item.role === "tool"), "the model only speaks after the forced result");
      return final("Votre demande est en cours.");
    } };
    await agentWith(model).process(cid);
    assert.equal(turn, 1);
    assert.equal(listed.length, 1);
    assert.equal((await lastBlocks(cid)).some((block) => block.type === "caseCard"), true);

    const bare = await newChat(session.token, "Où en est ma demande ?");
    let advertised;
    await agentWith({ async generate(_config, _history, tools) { advertised = tools.map((tool) => tool.name); return final("Je ne peux pas consulter vos demandes ici."); } }, false).process(bare.cid);
    assert.deepEqual(advertised, []);
    assert.equal(listed.length, 1);
  });

  const payCase = (n, status) => ({ ...caseAt(n, "2026-11-04T10:00:00Z"), status, requestId: "req_01JD00000000000000000000" + String(10 + n), payment: { ...fixtures.schemas.Case.payment, amountFcfa: 1900, status: status === "awaiting_payment" ? "pending" : "paid", ...(status === "awaiting_payment" ? { reference: null, paidAt: null } : {}) } });
  const PAY_HINT = "Pour payer, rouvrez la conversation de cette demande depuis « Mes démarches », puis écrivez « je veux payer ».";
  const payBlocks = (blocks) => blocks.filter((block) => block.type === "text" && block.text === PAY_HINT);
  const payButtons = (blocks) => blocks.filter((block) => block.type === "buttons" && block.items.some((item) => item.id.startsWith("payment.confirm.")));

  await t.test("cases.list in a new chat: a case awaiting payment elsewhere gets nextStep and one text after the cards, no button", async () => {
    listed.length = 0;
    casePages = [{ items: [payCase(7, "awaiting_payment"), payCase(8, "completed")], nextCursor: null }];
    const { session } = await login(NPI);
    const { cid } = await newChat(session.token, "Où en est ma demande ?");
    let seen;
    await agentWith({ async generate(_config, history) { seen = JSON.parse(history.findLast((item) => item.role === "tool").content).result; return final("Votre dossier attend le paiement."); } }).process(cid);
    const byReference = Object.fromEntries(seen.cases.map((item) => [item.reference, item]));
    assert.match(byReference["SIM-ACJ-2026-000017"].nextStep, /conversation d’origine/);
    assert.equal("nextStep" in byReference["SIM-ACJ-2026-000018"], false, "a paid case carries no nextStep");
    const blocks = await lastBlocks(cid);
    assert.equal(payBlocks(blocks).length, 1);
    assert.ok(blocks.findLastIndex((block) => block.type === "caseCard") < blocks.findIndex((block) => block.text === PAY_HINT), "the text follows the cards");
    assert.equal(payButtons(blocks).length, 0);
    assert.equal((await pool.query("SELECT 1 FROM backend_tool_results WHERE conversation_id=$1 AND tool_name='request.pay'", [cid])).rows.length, 0);
  });

  await t.test("cases.list: a paid or finished case from another conversation gets neither nextStep nor text", async () => {
    casePages = [{ items: [payCase(9, "completed"), payCase(10, "in_review")], nextCursor: null }];
    const { session } = await login(NPI);
    const { cid } = await newChat(session.token, "Où en est ma demande ?");
    let seen;
    await agentWith({ async generate(_config, history) { seen = history.findLast((item) => item.role === "tool").content; return final("Voici vos demandes."); } }).process(cid);
    assert.equal(seen.includes("nextStep"), false);
    assert.equal(payBlocks(await lastBlocks(cid)).length, 0);
  });

  await t.test("\u00ab je veux payer \u00bb in a new chat, signed in: cases.list is forced once, same result", async () => {
    listed.length = 0;
    casePages = [{ items: [payCase(11, "awaiting_payment")], nextCursor: null }];
    const { session } = await login(NPI);
    const { cid } = await newChat(session.token, "je veux payer");
    let turn = 0;
    await agentWith({ async generate(_config, history) { turn += 1; assert.ok(history.some((item) => item.role === "tool")); return final("Votre dossier attend le paiement."); } }).process(cid);
    assert.equal(turn, 1);
    assert.equal(listed.length, 1);
    const blocks = await lastBlocks(cid);
    assert.equal(payBlocks(blocks).length, 1);
    assert.equal(payButtons(blocks).length, 0);
  });

  await t.test("\u00ab je veux payer \u00bb in a new chat, guest: login asked, then cases.list replayed", async () => {
    listed.length = 0;
    casePages = [{ items: [payCase(12, "awaiting_payment")], nextCursor: null }];
    const guest = await request("/v1/guest-sessions", { method: "POST" });
    const { cid } = await newChat(guest.value.token, "je veux payer");
    await agentWith({ async generate() { return final("Connectez-vous pour continuer."); } }).process(cid);
    assert.equal(listed.length, 0);
    assert.ok((await lastBlocks(cid)).some((block) => block.type === "loginRequired"));
    const { session } = await login(NPI);
    const attached = await request("/v1/conversations/" + cid + "/attach", { method: "POST", body: { guestToken: guest.value.token }, bearer: session.token });
    assert.equal(attached.status, 200, attached.text);
    await agentWith({ async generate() { return final("Votre dossier attend le paiement."); } }).process(cid);
    assert.equal(listed.length, 1);
    const blocks = await lastBlocks(cid);
    assert.equal(payBlocks(blocks).length, 1);
    assert.equal(payButtons(blocks).length, 0);
  });

  await t.test("\u00ab je veux payer \u00bb with no case at all: no error, no extra text", async () => {
    casePages = [{ items: [], nextCursor: null }];
    const { session } = await login(NPI);
    const { cid } = await newChat(session.token, "je veux payer");
    await agentWith({ async generate() { return final("Vous n’avez aucun dossier à payer."); } }).process(cid);
    const blocks = await lastBlocks(cid);
    assert.equal(payBlocks(blocks).length, 0);
    assert.equal(payButtons(blocks).length, 0);
  });
});
