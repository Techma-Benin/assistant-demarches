import type { Pool } from "pg";
import { transaction } from "./transactions.js";
import { approvedMcpUrl } from "./domain.js";

export class Delivery {
  constructor(
    private pool: Pool,
    private callbackUrl: string,
    private token: () => Promise<string>,
  ) {
    if (!approvedMcpUrl(callbackUrl, new Set([new URL(callbackUrl).href])))
      throw new Error("Callback requires HTTPS outside localhost.");
  }
  async next() {
    return transaction(this.pool, async (db) => {
      // One in-flight delivery per conversation; preserve order even during retries.
      const row = (
        await db.query(
          "SELECT e.* FROM backend_conversation_events e JOIN backend_conversations c ON c.id=e.conversation_id WHERE c.body->>'channel'='whatsapp' AND e.body->'data'->>'kind'='message.sent' AND e.callback_delivered_at IS NULL AND NOT e.callback_failed AND e.callback_next_at<=now() AND NOT EXISTS(SELECT 1 FROM backend_conversation_events p WHERE p.conversation_id=e.conversation_id AND p.seq<e.seq AND p.body->'data'->>'kind'='message.sent' AND p.callback_delivered_at IS NULL AND NOT p.callback_failed) ORDER BY e.seq LIMIT 1 FOR UPDATE OF e SKIP LOCKED",
        )
      ).rows[0];
      if (!row) return false;
      let code = 0;
      try {
        const res = await fetch(this.callbackUrl, {
          method: "POST",
          redirect: "error",
          headers: {
            Authorization: "Bearer " + (await this.token()),
            "Content-Type": "application/json",
            traceparent: row.body.traceparent,
          },
          body: JSON.stringify(row.body),
          signal: AbortSignal.timeout(15000),
        });
        code = res.status;
        await res.body?.cancel();
      } catch {}
      if (code === 204)
        await db.query(
          "UPDATE backend_conversation_events SET callback_delivered_at=now(),callback_attempts=callback_attempts+1 WHERE id=$1",
          [row.id],
        );
      else {
        const failed = Date.now() - row.stored_at.getTime() >= 86400000;
        await db.query(
          "UPDATE backend_conversation_events SET callback_attempts=callback_attempts+1,callback_next_at=now()+($2::int * interval '1 second'),callback_failed=$3 WHERE id=$1",
          [
            row.id,
            Math.min(60, 2 ** Math.min(row.callback_attempts, 6)),
            failed,
          ],
        );
        if (code === 401 || code === 403)
          console.error(
            "WhatsApp callback authentication rejected; deployment configuration requires attention.",
          );
      }
      return true;
    });
  }
}
