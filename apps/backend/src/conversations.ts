import { randomBytes, createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import {
  identifier,
  fingerprint,
  validate,
  Problem,
  type Schemas,
} from "./domain.js";
import type { User } from "./identity.js";
import { idempotent, transaction } from "./transactions.js";

export type Conversation = Schemas["Conversation"];
export type Event = Schemas["Event"];
export type MessageInput = Schemas["MessageInput"];
type Db = Pick<Pool, "query"> | Pick<PoolClient, "query">;
export function envelope(
  data: Event["data"],
  traceparent: string,
  source = "backend",
): Event {
  const event = {
    specversion: "1.0",
    id: identifier("evt"),
    source: "urn:techma:" + source,
    type: `bj.techma.${data.kind}.v1`,
    time: new Date().toISOString(),
    datacontenttype: "application/json",
    traceparent,
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
  if (event.type !== `bj.techma.${event.data.kind}.v1`)
    throw new Problem(400, "INVALID_REQUEST", "Type événement incohérent.");
  // Keep all event writes ordered with respect to the conversation, across API/worker instances.
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    conversationId,
  ]);
  await db.query(
    "INSERT INTO backend_conversation_events(id,conversation_id,body) VALUES($1,$2,$3)",
    [event.id, conversationId, event],
  );
}
export class Conversations {
  constructor(readonly pool: Pool) {}
  async owner(db: Db, id: string, userRef: string): Promise<Conversation> {
    const row = (
      await db.query(
        "SELECT body FROM backend_conversations WHERE id=$1 AND user_ref=$2",
        [id, userRef],
      )
    ).rows[0];
    if (!row) throw new Problem(404, "NOT_FOUND", "Conversation introuvable.");
    return row.body;
  }
  async create(user: User, body: Schemas["ConversationInput"], key: string) {
    validate("ConversationInput", body);
    if ((body.channel === "whatsapp") !== (user.channel === "whatsapp"))
      throw new Problem(403, "FORBIDDEN", "Canal incompatible avec le jeton.");
    return idempotent(
      this.pool,
      [user.userRef, "POST", "/v1/conversations"],
      key,
      body,
      async (db) => {
        const value: Conversation = {
          id: identifier("cnv"),
          userRef: user.userRef,
          ...body,
          createdAt: new Date().toISOString(),
        };
        await db.query(
          "INSERT INTO backend_conversations(id,user_ref,administration_id,body) VALUES($1,$2,$3,$4)",
          [value.id, user.userRef, user.administrationId, value],
        );
        return value;
      },
    );
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
            if (file.scanStatus !== "clean")
              throw new Problem(409, "INVALID_REQUEST", "Pièce non validée.");
          }
          await db.query(
            "INSERT INTO backend_messages(conversation_id,id,fingerprint,body,traceparent) VALUES($1,$2,$3,$4,$5)",
            [conversationId, body.id, fingerprint(body), body, traceparent],
          );
          await appendEvent(
            db,
            conversationId,
            envelope(
              { kind: "message.received", conversationId, messageId: body.id },
              traceparent,
            ),
          );
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
    const { rows } = await this.pool.query(
      "SELECT body FROM backend_conversation_events WHERE conversation_id=$1 AND seq>$2 AND expires_at>now() ORDER BY seq LIMIT 100",
      [conversationId, after],
    );
    const items: Event[] = rows.map((row) => row.body);
    return { items, nextCursor: items.at(-1)?.id ?? cursor ?? null };
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
  ): Promise<{ conversation: Conversation; expiresAt: number }> {
    const result = await this.pool.query(
      "DELETE FROM backend_socket_tickets WHERE digest=$1 AND expires_at>now() RETURNING conversation_id,token_expires_at",
      [createHash("sha256").update(ticket).digest("hex")],
    );
    const row = result.rows[0];
    if (!row) throw new Problem(401, "UNAUTHORIZED", "Ticket invalide.");
    const conversation = (
      await this.pool.query(
        "SELECT body FROM backend_conversations WHERE id=$1",
        [row.conversation_id],
      )
    ).rows[0].body;
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
    if (event.type !== `bj.techma.${event.data.kind}.v1`)
      throw new Problem(400, "INVALID_REQUEST", "Type événement incohérent.");
    if (event.source !== "urn:techma:tooling")
      throw new Problem(403, "FORBIDDEN", "Source événement incompatible.");
    const data = event.data;
    if (
      data.kind === "message.received" ||
      data.kind === "message.sent" ||
      data.kind === "configuration.changed"
    )
      throw new Problem(403, "FORBIDDEN", "Événement réservé au Backend.");
    const cid =
      "conversationId" in data
        ? data.conversationId
        : "request" in data
          ? data.request.conversationId
          : data.mandate.conversationId;
    return idempotent(
      this.pool,
      ["tooling-events", "POST", "/internal/v1/events"],
      key,
      event,
      async (db) => {
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
        const conversation = (
          await db.query("SELECT body FROM backend_conversations WHERE id=$1", [
            cid,
          ])
        ).rows[0]?.body as Conversation | undefined;
        if (!conversation)
          throw new Problem(404, "NOT_FOUND", "Conversation introuvable.");
        if ("request" in data) {
          if (data.request.userRef !== conversation.userRef)
            throw new Problem(403, "FORBIDDEN", "Propriétaire incompatible.");
          const existing = (
            await db.query(
              "SELECT conversation_id,user_ref FROM backend_requests WHERE id=$1",
              [data.request.id],
            )
          ).rows[0];
          if (
            existing &&
            (existing.conversation_id !== cid ||
              existing.user_ref !== conversation.userRef)
          )
            throw new Problem(403, "FORBIDDEN", "Demande incompatible.");
          await db.query(
            "INSERT INTO backend_requests(id,conversation_id,user_ref,body,last_event_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO UPDATE SET body=excluded.body,last_event_at=excluded.last_event_at WHERE backend_requests.last_event_at<=excluded.last_event_at",
            [
              data.request.id,
              cid,
              conversation.userRef,
              data.request,
              event.time,
            ],
          );
        } else if (data.kind === "request.status_changed") {
          const result = await db.query(
            "UPDATE backend_requests SET body=jsonb_set(jsonb_set(body,'{status}',to_jsonb($1::text)),'{updatedAt}',to_jsonb($2::text)),last_event_at=$3 WHERE id=$4 AND conversation_id=$5 AND last_event_at<=$3",
            [data.to, data.at, event.time, data.requestId, cid],
          );
          if (
            !result.rowCount &&
            !(
              await db.query(
                "SELECT 1 FROM backend_requests WHERE id=$1 AND conversation_id=$2",
                [data.requestId, cid],
              )
            ).rowCount
          )
            throw new Problem(404, "NOT_FOUND", "Demande inconnue.");
        } else if ("mandate" in data) {
          if (data.mandate.userRef !== conversation.userRef)
            throw new Problem(403, "FORBIDDEN", "Propriétaire incompatible.");
          const previous = (
            await db.query(
              "SELECT conversation_id,body FROM backend_mandates WHERE id=$1",
              [data.mandate.id],
            )
          ).rows[0];
          if (previous && previous.conversation_id !== cid)
            throw new Problem(403, "FORBIDDEN", "Mandat incompatible.");
          if (!previous || previous.body.status !== "revoked")
            await db.query(
              "INSERT INTO backend_mandates(id,conversation_id,user_ref,body) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO UPDATE SET body=excluded.body",
              [data.mandate.id, cid, conversation.userRef, data.mandate],
            );
        }
        await appendEvent(db, cid, event);
        await db.query(
          "INSERT INTO backend_ingested_events(id,fingerprint) VALUES($1,$2)",
          [event.id, fingerprint(event)],
        );
        return event;
      },
    );
  }
  async complete(
    db: PoolClient,
    conversationId: string,
    inputId: string,
    blocks: Schemas["AgentMessage"]["blocks"],
    traceparent: string,
    preserveError = false,
  ) {
    const message = {
      id: identifier("msg"),
      conversationId,
      blocks,
      createdAt: new Date().toISOString(),
    };
    validate("AgentMessage", message);
    await appendEvent(
      db,
      conversationId,
      envelope({ kind: "message.sent", conversationId, message }, traceparent),
    );
    await db.query(
      "UPDATE backend_messages SET processed_at=now(),last_error=CASE WHEN $3 THEN last_error ELSE NULL END WHERE conversation_id=$1 AND id=$2",
      [conversationId, inputId, preserveError],
    );
    return message;
  }
}
