import { test } from "node:test";
import assert from "node:assert/strict";
import { isolatedDatabase } from "./helpers.mjs";
import { database, migrate } from "../dist/apps/backend/src/database.js";
import { identifier } from "../dist/apps/backend/src/domain.js";
import { Conversations, RESUME_AFTER_LOGIN } from "../dist/apps/backend/src/conversations.js";
import { transaction } from "../dist/apps/backend/src/transactions.js";

const tp = "00-" + "1".repeat(32) + "-" + "2".repeat(16) + "-01";

test("attach queues the login resume for every migrated conversation that was waiting for the login, once", async (t) => {
  const pg = await isolatedDatabase();
  const pool = database(pg.connection);
  t.after(async () => { await pool.end(); await pg.close(); });
  await migrate(pool);
  const conversations = new Conversations(pool);
  const guest = { userRef: identifier("usr"), channel: "web", authenticated: false, expiresAt: Date.now() + 60000, roles: new Set() };
  const user = { userRef: identifier("usr"), channel: "web", authenticated: true, expiresAt: Date.now() + 60000, roles: new Set() };

  async function conversationEndingWith(blocks) {
    const conversation = await conversations.create(guest, { locale: "fr" }, identifier("key"));
    const message = { id: identifier("msg"), content: { type: "text", text: "Je veux déposer ma demande" }, sentAt: new Date().toISOString() };
    await conversations.accept(guest, conversation.id, message, identifier("key"), tp);
    await transaction(pool, (db) => conversations.complete(db, conversation.id, message.id, blocks, tp));
    return conversation.id;
  }
  const loginBlocks = [{ type: "text", text: "Connectez-vous.", sources: [] }, { type: "loginRequired", reason: "Connexion requise." }];
  const waitingA = await conversationEndingWith(loginBlocks);
  const waitingB = await conversationEndingWith(loginBlocks);
  const answered = await conversationEndingWith([{ type: "text", text: "Voici la réponse.", sources: [] }]);

  const consume = async () => {};
  // The path conversation is the answered one: the two others must still be resumed.
  await conversations.attach(user, answered, guest, consume);
  const resumes = async (id) => (await pool.query(
    "SELECT id, processed_at FROM backend_messages WHERE conversation_id=$1 AND body->'content'->>'text'=$2",
    [id, RESUME_AFTER_LOGIN],
  )).rows;
  assert.equal((await resumes(waitingA)).length, 1);
  assert.equal((await resumes(waitingB)).length, 1);
  assert.equal((await resumes(answered)).length, 0, "a conversation whose last reply did not ask for the login is not resumed");
  assert.ok((await resumes(waitingA))[0].processed_at === null);

  // The resume is a technical turn: it never shows up as a message of the user.
  for (const id of [waitingA, waitingB]) {
    const kinds = (await pool.query("SELECT body->'data'->>'kind' AS kind FROM backend_conversation_events WHERE conversation_id=$1 ORDER BY seq", [id])).rows.map((row) => row.kind);
    assert.deepEqual(kinds, ["message.received", "message.sent"]);
    assert.equal((await pool.query("SELECT user_ref FROM backend_conversations WHERE id=$1", [id])).rows[0].user_ref, user.userRef);
  }

  // Replaying the attach does not queue anything twice.
  await conversations.attach(user, answered, guest, consume);
  await conversations.attach(user, waitingA, guest, consume);
  assert.equal((await resumes(waitingA)).length, 1);
  assert.equal((await resumes(waitingB)).length, 1);
});
