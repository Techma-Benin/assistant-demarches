import { randomBytes, createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { Pool, PoolClient } from "pg";
import {
  identifier,
  fingerprint,
  validate,
  Problem,
  type Schemas,
} from "./domain.js";
import type { User } from "./identity.js";
import { redact } from "./model.js";
import { idempotent, transaction } from "./transactions.js";

export type Conversation = Schemas["Conversation"];
/** Conversation row plus the owner, which the public schema no longer carries. */
export type OwnedConversation = Conversation & { userRef: string };
export type Event = Schemas["Event"];
export type MessageInput = Schemas["MessageInput"];
type Db = Pick<Pool, "query"> | Pick<PoolClient, "query">;

/** Case bodies already shown in this conversation, newest first (`afterSeq`: only those published after that event). */
async function shownCases(
  db: Db,
  conversationId: string,
  caseId: string | null,
  afterSeq = 0,
): Promise<Schemas["Case"][]> {
  const rows = (
    await db.query(
      `SELECT body FROM backend_conversation_events
       WHERE conversation_id=$1 AND seq>$2 AND body->'data'->>'kind'='message.sent'
       ORDER BY seq DESC LIMIT 50`,
      [conversationId, afterSeq],
    )
  ).rows;
  const cases: Schemas["Case"][] = [];
  for (const row of rows)
    for (const block of row.body?.data?.message?.blocks ?? [])
      if (
        block?.type === "caseCard" &&
        (caseId === null || block.case?.id === caseId)
      )
        cases.push(block.case);
  return cases;
}
export function envelope(
  data: Event["data"],
  _traceparent: string,
  source = "backend",
): Event {
  const event = {
    specversion: "1.0",
    id: identifier("evt"),
    source: "urn:techma:" + source,
    type: `bj.techma.${data.kind}.v2`,
    time: new Date().toISOString(),
    datacontenttype: "application/json" as const,
    data,
  };
  validate("Event", event);
  return event as Event;
}
export async function appendEvent(
  db: Db,
  conversationId: string,
  event: Event,
): Promise<void> {
  validate("Event", event);
  if (event.type !== `bj.techma.${event.data.kind}.v2`)
    throw new Problem(400, "INVALID_REQUEST", "Type événement incohérent.");
  // Keep all event writes ordered with respect to the conversation, across API/worker instances.
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    conversationId,
  ]);
  // Received and sent are the durable history. Deltas and technical events keep the 48h default.
  const durable = event.data.kind === "message.received" || event.data.kind === "message.sent";
  if (durable)
    await db.query(
      "INSERT INTO backend_conversation_events(id,conversation_id,body,expires_at) VALUES($1,$2,$3,'infinity')",
      [event.id, conversationId, event],
    );
  else
    await db.query(
      "INSERT INTO backend_conversation_events(id,conversation_id,body) VALUES($1,$2,$3)",
      [event.id, conversationId, event],
    );
}
/** Keeps Conversation.lastMessageAt in step with the message events, in the same transaction. */
async function touchLastMessage(db: Db, conversationId: string, time: string): Promise<void> {
  await db.query(
    "UPDATE backend_conversations SET body=jsonb_set(body,'{lastMessageAt}',to_jsonb($2::text),true) WHERE id=$1",
    [conversationId, time],
  );
}
export const RESUME_AFTER_CONSENT =
  "L’usager vient d’accorder l’autorisation demandée dans l’interface. Reprends l’action qui attendait cette autorisation, sans redemander ce qui a déjà été fourni.";
export const RESUME_AFTER_LOGIN =
  "L’usager vient de se connecter. Reprends l’action qui demandait une connexion, sans redemander ce qui a déjà été fourni.";
export class Conversations {
  private readonly liveListeners = new Map<string, Set<(event: Event) => void>>();
  constructor(readonly pool: Pool) {}
  /** Fired after a message.delta, message.sent or transcript message.received transaction has committed: wakes the sockets. */
  onLive(conversationId: string, listener: (event: Event) => void): () => void {
    let listeners = this.liveListeners.get(conversationId);
    if (!listeners) {
      listeners = new Set();
      this.liveListeners.set(conversationId, listeners);
    }
    listeners.add(listener);
    return () => {
      listeners!.delete(listener);
      if (listeners!.size === 0) this.liveListeners.delete(conversationId);
    };
  }
  emitLive(conversationId: string, event: Event): void {
    const kind = event.data.kind;
    if (kind !== "message.delta" && kind !== "message.sent" && kind !== "message.received") return;
    const listeners = this.liveListeners.get(conversationId);
    if (!listeners) return;
    for (const listener of [...listeners]) {
      try { listener(event); }
      catch { /* A closed socket must not undo a committed event. */ }
    }
  }
  /**
   * Queues a Backend-written turn for the agent (nothing is shown as a user message): used when the Interface
   * cannot send anything itself, after the consent click (POST …/mandates) or after the login attach.
   */
  async enqueueResume(db: Db, conversationId: string, text: string): Promise<void> {
    const body = { id: identifier("msg"), content: { type: "text", text }, sentAt: new Date().toISOString() };
    const traceparent = `00-${randomBytes(16).toString("hex")}-${randomBytes(8).toString("hex")}-01`;
    await db.query(
      "INSERT INTO backend_messages(conversation_id,id,fingerprint,body,traceparent) VALUES($1,$2,$3,$4,$5)",
      [conversationId, body.id, fingerprint(body), body, traceparent],
    );
  }
  async owner(db: Db, id: string, userRef: string): Promise<OwnedConversation> {
    const row = (
      await db.query(
        "SELECT body, user_ref FROM backend_conversations WHERE id=$1 AND user_ref=$2",
        [id, userRef],
      )
    ).rows[0];
    if (!row) throw new Problem(404, "NOT_FOUND", "Conversation introuvable.");
    return { ...row.body, userRef: row.user_ref };
  }
  async list(userRef: string, limit: number, cursor?: string) {
    const after = cursor
      ? (
          await this.pool.query(
            "SELECT created_at FROM backend_conversations WHERE id=$1 AND user_ref=$2",
            [cursor, userRef],
          )
        ).rows[0]?.created_at
      : null;
    if (cursor && !after)
      throw new Problem(400, "INVALID_REQUEST", "Curseur invalide.");
    const { rows } = await this.pool.query(
      "SELECT id, body FROM backend_conversations WHERE user_ref=$1 AND ($2::timestamptz IS NULL OR created_at<$2 OR (created_at=$2 AND id<$3)) ORDER BY created_at DESC, id DESC LIMIT $4",
      [userRef, after, cursor ?? "", limit + 1],
    );
    const page = rows.slice(0, limit);
    return {
      items: page.map((row) => row.body as Conversation),
      nextCursor: rows.length > limit ? page.at(-1).id : null,
    };
  }
  async create(user: User, body: Schemas["ConversationInput"], key: string) {
    validate("ConversationInput", body);
    return idempotent(
      this.pool,
      [user.userRef, "POST", "/v1/conversations"],
      key,
      body,
      async (db) => {
        const value: Conversation = {
          id: identifier("cnv"),
          channel: user.channel,
          locale: body.locale,
          authenticated: user.authenticated,
          createdAt: new Date().toISOString(),
          lastMessageAt: null,
        };
        await db.query(
          "INSERT INTO backend_conversations(id,user_ref,administration_id,body) VALUES($1,$2,'global',$3)",
          [value.id, user.userRef, value],
        );
        return value;
      },
    );
  }
  async attach(
    user: User,
    conversationId: string,
    guest: User & { consumed?: boolean },
    consumeGuest: (userRef: string, db: Db) => Promise<void>,
  ) {
    if (!user.authenticated)
      throw new Problem(401, "LOGIN_REQUIRED", "Connexion requise.");
    if (guest.authenticated || guest.userRef === user.userRef)
      throw new Problem(400, "INVALID_REQUEST", "Jeton invité requis.");
    return transaction(this.pool, async (db) => {
      const existing = (
        await db.query(
          "SELECT body FROM backend_conversations WHERE id=$1 AND user_ref=$2",
          [conversationId, user.userRef],
        )
      ).rows[0];
      if (existing) return existing.body as Conversation;
      await consumeGuest(guest.userRef, db);
      const ownedByGuest = (
        await db.query(
          "SELECT 1 FROM backend_conversations WHERE id=$1 AND user_ref=$2",
          [conversationId, guest.userRef],
        )
      ).rows[0];
      if (!ownedByGuest)
        throw new Problem(404, "NOT_FOUND", "Conversation introuvable.");
      const moved = await db.query(
        "UPDATE backend_conversations SET user_ref=$1, body=jsonb_set(body,'{authenticated}','true'::jsonb) WHERE user_ref=$2 RETURNING id, body",
        [user.userRef, guest.userRef],
      );
      if (!moved.rows.some((row) => row.id === conversationId))
        throw new Problem(404, "NOT_FOUND", "Conversation introuvable.");
      await db.query(
        "UPDATE backend_files SET user_ref=$1 WHERE user_ref=$2",
        [user.userRef, guest.userRef],
      );
      for (const table of ["backend_mandates", "backend_requests"])
        await db.query(
          `UPDATE ${table} SET user_ref=$1 WHERE user_ref=$2`,
          [user.userRef, guest.userRef],
        );
      // Every migrated conversation whose last reply asked for the login is still waiting: pick each up where it stopped.
      for (const row of moved.rows) {
        const last = (
          await db.query(
            "SELECT body->'data'->'message'->'blocks' AS blocks FROM backend_conversation_events WHERE conversation_id=$1 AND body->'data'->>'kind'='message.sent' ORDER BY seq DESC LIMIT 1",
            [row.id],
          )
        ).rows[0];
        if (!Array.isArray(last?.blocks) || !last.blocks.some((block: { type?: string }) => block.type === "loginRequired")) continue;
        // A resume already waiting (same attach replayed) is never queued twice.
        const waiting = (
          await db.query(
            "SELECT 1 FROM backend_messages WHERE conversation_id=$1 AND processed_at IS NULL AND body->'content'->>'text'=$2 LIMIT 1",
            [row.id, RESUME_AFTER_LOGIN],
          )
        ).rows[0];
        if (!waiting) await this.enqueueResume(db, row.id, RESUME_AFTER_LOGIN);
      }
      return moved.rows.find((row) => row.id === conversationId).body as Conversation;
    });
  }
  async accept(
    user: User,
    conversationId: string,
    body: MessageInput,
    key: string,
    traceparent: string,
  ) {
    validate("MessageInput", body);
    return idempotent(
      this.pool,
      [user.userRef, "POST", conversationId, "messages"],
      key,
      body,
      async (db) => {
        await this.owner(db, conversationId, user.userRef);
        await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          conversationId,
        ]);
        const previous = (
          await db.query(
            "SELECT fingerprint FROM backend_messages WHERE conversation_id=$1 AND id=$2",
            [conversationId, body.id],
          )
        ).rows[0];
        if (previous && previous.fingerprint !== fingerprint(body))
          throw new Problem(
            409,
            "IDEMPOTENCY_CONFLICT",
            "Identifiant message réutilisé.",
          );
        if (!previous) {
          if (
            body.content.type === "text" &&
            body.content.text.trim().toUpperCase() === "STOP"
          )
            await db.query(
              "UPDATE backend_conversations SET actions_paused=true WHERE id=$1",
              [conversationId],
            );
          if ("fileId" in body.content) {
            const file = (
              await db.query(
                "SELECT body FROM backend_files WHERE id=$1 AND user_ref=$2 AND expires_at>now()",
                [body.content.fileId, user.userRef],
              )
            ).rows[0]?.body;
            if (!file)
              throw new Problem(404, "NOT_FOUND", "Pièce introuvable.");
          }
          const stored =
            body.content.type === "text"
              ? { ...body, content: { ...body.content, text: redact(body.content.text) } }
              : body;
          await db.query(
            "INSERT INTO backend_messages(conversation_id,id,fingerprint,body,traceparent) VALUES($1,$2,$3,$4,$5)",
            [conversationId, body.id, fingerprint(body), stored, traceparent],
          );
          const received = envelope(
            {
              kind: "message.received",
              conversationId,
              message: {
                id: stored.id,
                content: stored.content,
                transcript: null,
                sentAt: stored.sentAt,
              },
            },
            traceparent,
          );
          await appendEvent(db, conversationId, received);
          await touchLastMessage(db, conversationId, received.time);
        }
        return {
          messageId: body.id,
          conversationId,
          status: "accepted" as const,
        };
      },
    );
  }
  async page(userRef: string, conversationId: string, cursor?: string) {
    await this.owner(this.pool, conversationId, userRef);
    let after = "0";
    if (cursor) {
      const previous = (
        await this.pool.query(
          "SELECT seq FROM backend_conversation_events WHERE id=$1 AND conversation_id=$2 AND expires_at>now()",
          [cursor, conversationId],
        )
      ).rows[0];
      if (!previous)
        throw new Problem(410, "REPLAY_EXPIRED", "Curseur inconnu ou expiré.");
      after = previous.seq;
    }
    const kinds = cursor
      ? "('message.received','message.sent','message.delta')"
      : "('message.received','message.sent')";
    const { rows } = await this.pool.query(
      `SELECT body FROM backend_conversation_events WHERE conversation_id=$1 AND seq>$2 AND expires_at>now() AND body->'data'->>'kind' IN ${kinds} ORDER BY seq LIMIT 100`,
      [conversationId, after],
    );
    const items: Event[] = rows.map((row) => row.body);
    return { items, nextCursor: items.at(-1)?.id ?? cursor ?? null };
  }
  async appendDelta(
    conversationId: string,
    messageId: string,
    delta: string,
    index: number,
    traceparent: string,
  ): Promise<number> {
    if (!delta) return 0;
    let written = 0;
    for (let offset = 0; offset < delta.length; offset += 8000) {
      const event = await transaction(this.pool, async (db) => {
        const value = envelope(
          {
            kind: "message.delta",
            conversationId,
            messageId,
            delta: delta.slice(offset, offset + 8000),
            index: index + written,
          },
          traceparent,
        );
        await appendEvent(db, conversationId, value);
        return value;
      });
      written += 1;
      this.emitLive(conversationId, event);
    }
    return written;
  }
  async ticket(
    user: User,
    conversationId: string,
    key: string,
    socketUrl: string,
  ) {
    return idempotent(
      this.pool,
      [user.userRef, "POST", conversationId, "socket-ticket"],
      key,
      {},
      async (db) => {
        await this.owner(db, conversationId, user.userRef);
        const ticket = randomBytes(32).toString("base64url");
        const expiresAt = new Date(
          Math.min(user.expiresAt, Date.now() + 60000),
        ).toISOString();
        await db.query(
          "INSERT INTO backend_socket_tickets(digest,conversation_id,expires_at,token_expires_at) VALUES($1,$2,$3,$4)",
          [
            createHash("sha256").update(ticket).digest("hex"),
            conversationId,
            expiresAt,
            new Date(user.expiresAt),
          ],
        );
        return {
          ticket,
          expiresAt,
          url: socketUrl + "?ticket=" + encodeURIComponent(ticket),
        };
      },
    );
  }
  async consumeTicket(
    ticket: string,
  ): Promise<{ conversation: OwnedConversation; expiresAt: number }> {
    const result = await this.pool.query(
      "DELETE FROM backend_socket_tickets WHERE digest=$1 AND expires_at>now() RETURNING conversation_id,token_expires_at",
      [createHash("sha256").update(ticket).digest("hex")],
    );
    const row = result.rows[0];
    if (!row) throw new Problem(401, "UNAUTHORIZED", "Ticket invalide.");
    const stored = (
      await this.pool.query(
        "SELECT body, user_ref FROM backend_conversations WHERE id=$1",
        [row.conversation_id],
      )
    ).rows[0];
    const conversation: OwnedConversation = {
      ...stored.body,
      userRef: stored.user_ref,
    };
    // Ticket lifetime gates the upgrade; the signed user's original expiry gates the socket.
    return { conversation, expiresAt: row.token_expires_at.getTime() };
  }
  async request(userRef: string, id: string) {
    const row = (
      await this.pool.query(
        "SELECT body FROM backend_requests WHERE id=$1 AND user_ref=$2",
        [id, userRef],
      )
    ).rows[0];
    if (!row) throw new Problem(404, "NOT_FOUND", "Demande introuvable.");
    return row.body;
  }
  async ingest(event: Event, key: string) {
    validate("Event", event);
    if (event.type !== `bj.techma.${event.data.kind}.v2`)
      throw new Problem(400, "INVALID_REQUEST", "Type événement incohérent.");
    if (event.source !== "urn:techma:tooling")
      throw new Problem(403, "FORBIDDEN", "Source événement incompatible.");
    const data = event.data;
    if (data.kind === "message.received" || data.kind === "message.sent")
      throw new Problem(403, "FORBIDDEN", "Événement réservé au Backend.");
    const cid =
      "mandate" in data ? data.mandate.conversationId : data.conversationId;
    const committed: Event[] = [];
    const result = await idempotent(
      this.pool,
      ["tooling", "POST", "/internal/v1/events"],
      key,
      event,
      async (db) => {
        committed.length = 0;
        await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          "event:" + event.id,
        ]);
        await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          cid,
        ]);
        const known = (
          await db.query(
            "SELECT fingerprint FROM backend_ingested_events WHERE id=$1",
            [event.id],
          )
        ).rows[0];
        if (known) {
          if (known.fingerprint !== fingerprint(event))
            throw new Problem(
              409,
              "IDEMPOTENCY_CONFLICT",
              "Identifiant événement réutilisé.",
            );
          return event;
        }
        const stored = (
          await db.query(
            "SELECT body, user_ref FROM backend_conversations WHERE id=$1",
            [cid],
          )
        ).rows[0];
        if (!stored)
          throw new Problem(404, "NOT_FOUND", "Conversation introuvable.");
        const userRef = stored.user_ref as string;
        if (data.kind === "mandate.granted" || data.kind === "mandate.revoked") {
          if (data.mandate.userRef !== userRef)
            throw new Problem(403, "FORBIDDEN", "Propriétaire incompatible.");
          const previous = (
            await db.query(
              "SELECT conversation_id, body FROM backend_mandates WHERE id=$1",
              [data.mandate.id],
            )
          ).rows[0];
          if (previous && previous.conversation_id !== cid)
            throw new Problem(403, "FORBIDDEN", "Mandat incompatible.");
          if (!previous || previous.body.status !== "revoked")
            await db.query(
              "INSERT INTO backend_mandates(id,conversation_id,user_ref,body) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO UPDATE SET body=excluded.body",
              [data.mandate.id, cid, userRef, data.mandate],
            );
        } else if (data.kind === "case.updated") {
          const [latest] = await shownCases(db, cid, data.case.id);
          if (latest && isDeepStrictEqual(latest, data.case)) {
            await db.query(
              "INSERT INTO backend_ingested_events(id,fingerprint) VALUES($1,$2)",
              [event.id, fingerprint(event)],
            );
            return event;
          }
          const message = {
            id: identifier("msg"),
            conversationId: cid,
            blocks: [{ type: "caseCard" as const, case: data.case }],
            createdAt: new Date().toISOString(),
          };
          validate("AgentMessage", message);
          const sent = envelope(
            { kind: "message.sent", conversationId: cid, message },
            "00-" + "a".repeat(32) + "-" + "b".repeat(16) + "-01",
          );
          await appendEvent(db, cid, sent);
          committed.push(sent);
        }
        if (data.kind !== "case.updated") await appendEvent(db, cid, event);
        await db.query(
          "INSERT INTO backend_ingested_events(id,fingerprint) VALUES($1,$2)",
          [event.id, fingerprint(event)],
        );
        return event;
      },
    );
    for (const sent of committed) this.emitLive(cid, sent);
    return result;
  }
  async recordTranscript(
    conversationId: string,
    messageId: string,
    transcript: string,
    traceparent: string,
  ) {
    const event = await transaction(this.pool, async (db) => {
      const updated = await db.query(
        `UPDATE backend_conversation_events
         SET body=jsonb_set(body,'{data,message,transcript}',to_jsonb($3::text),true)
         WHERE conversation_id=$1
           AND body->'data'->>'kind'='message.received'
           AND body->'data'->'message'->>'id'=$2
         RETURNING body`,
        [conversationId, messageId, transcript],
      );
      const message = updated.rows[0]?.body?.data?.message;
      if (!message) return undefined;
      // Updated row is what GET …/events replays. A new event carries the
      // same UserMessage so the live stream (cursor past the original) sees it.
      const value = envelope(
        { kind: "message.received", conversationId, message },
        traceparent,
      );
      await appendEvent(db, conversationId, value);
      return value;
    });
    if (event) this.emitLive(conversationId, event);
  }
  async complete(
    db: PoolClient,
    conversationId: string,
    inputId: string,
    blocks: Schemas["AgentMessage"]["blocks"],
    traceparent: string,
    preserveError = false,
    messageId?: string,
  ): Promise<Event> {
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      conversationId,
    ]);
    const received = (
      await db.query(
        `SELECT seq FROM backend_conversation_events
         WHERE conversation_id=$1 AND body->'data'->>'kind'='message.received'
           AND body->'data'->'message'->>'id'=$2
         ORDER BY seq DESC LIMIT 1`,
        [conversationId, inputId],
      )
    ).rows[0];
    if (received) {
      const shown = await shownCases(db, conversationId, null, Number(received.seq));
      const kept = blocks.filter(
        (block) =>
          !(
            block.type === "caseCard" &&
            shown.some((c) => isDeepStrictEqual(c, block.case))
          ),
      );
      if (kept.length > 0) blocks = kept;
    }
    const message = {
      id: messageId ?? identifier("msg"),
      conversationId,
      blocks,
      createdAt: new Date().toISOString(),
    };
    validate("AgentMessage", message);
    const event = envelope({ kind: "message.sent", conversationId, message }, traceparent);
    await appendEvent(db, conversationId, event);
    await touchLastMessage(db, conversationId, event.time);
    await db.query(
      "UPDATE backend_messages SET processed_at=now(),last_error=CASE WHEN $3 THEN last_error ELSE NULL END WHERE conversation_id=$1 AND id=$2",
      [conversationId, inputId, preserveError],
    );
    return event;
  }
}
