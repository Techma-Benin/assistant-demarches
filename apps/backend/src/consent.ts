import type { Pool } from "pg";
import { SignJWT, type CryptoKey } from "jose";
import { identifier, validate, Problem, type Schemas } from "./domain.js";
import { Conversations, appendEvent, envelope } from "./conversations.js";
import { idempotent, transaction } from "./transactions.js";
import type { User } from "./identity.js";
import type { MandateControl } from "./tooling.js";

export class Consent {
  constructor(
    private pool: Pool,
    private conversations: Conversations,
    private control: MandateControl,
    private signing: { key: CryptoKey; kid: string; issuer: string },
  ) {}
  async challenge(
    user: User,
    cid: string,
    input: Schemas["ChallengeInput"],
    key: string,
  ) {
    validate("ChallengeInput", input);
    return idempotent(
      this.pool,
      [user.userRef, "POST", cid, "mandate-challenges"],
      key,
      input,
      async (db) => {
        await this.conversations.owner(db, cid, user.userRef);
        const procedure = (
          await db.query(
            "SELECT body FROM backend_configurations WHERE administration_id=$1 AND resource='procedures' AND resource_id=$2 AND body->>'validationStatus'='validated'",
            [user.administrationId, input.procedureId],
          )
        ).rows[0]?.body;
        if (!procedure)
          throw new Problem(404, "NOT_FOUND", "Démarche validée introuvable.");
        const id = identifier("chl"),
          exp = Math.floor(Date.now() / 1000) + 300;
        const proofToken = await new SignJWT({
          conversationId: cid,
          procedureId: input.procedureId,
          scopes: input.scopes,
        })
          .setProtectedHeader({ alg: "RS256", kid: this.signing.kid })
          .setIssuer(this.signing.issuer)
          .setAudience("techma-mandate")
          .setSubject(user.userRef)
          .setJti(id)
          .setIssuedAt()
          .setExpirationTime(exp)
          .sign(this.signing.key);
        const challenge = {
          id,
          conversationId: cid,
          userRef: user.userRef,
          ...input,
          proofToken,
          consentText:
            "Autoriser la préparation de « " +
            procedure.title +
            " » pendant une heure : " +
            input.scopes.join(", ") +
            ". La validation officielle reste sur le portail.",
          expiresAt: new Date(exp * 1000).toISOString(),
        };
        validate("Challenge", challenge);
        await db.query(
          "INSERT INTO backend_challenges(id,conversation_id,body) VALUES($1,$2,$3)",
          [id, cid, challenge],
        );
        return challenge;
      },
    );
  }
  async grant(
    user: User,
    cid: string,
    input: Schemas["Consent"],
    key: string,
    traceparent: string,
  ) {
    validate("Consent", input);
    // Persist the interaction before the external call; retries reuse identical evidence.
    await transaction(this.pool, async (db) => {
      await this.conversations.owner(db, cid, user.userRef);
      const row = (
        await db.query(
          "SELECT body,evidence,consumed_at FROM backend_challenges WHERE id=$1 AND conversation_id=$2 FOR UPDATE",
          [input.challengeId, cid],
        )
      ).rows[0];
      if (!row || row.body.userRef !== user.userRef)
        throw new Problem(403, "FORBIDDEN", "Challenge incompatible.");
      if (!row.evidence) {
        if (Date.parse(row.body.expiresAt) <= Date.now())
          throw new Problem(403, "FORBIDDEN", "Challenge expiré.");
        await db.query(
          "UPDATE backend_challenges SET evidence=$2 WHERE id=$1",
          [
            input.challengeId,
            {
              challenge: row.body,
              acceptedAt: new Date().toISOString(),
              evidenceRef: identifier("proof"),
              interaction: { accepted: true, userRef: user.userRef },
            },
          ],
        );
      }
    });
    return idempotent(
      this.pool,
      [user.userRef, "POST", cid, "mandates"],
      key,
      input,
      async (db) => {
        await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          cid,
        ]);
        const row = (
          await db.query(
            "SELECT evidence,consumed_at FROM backend_challenges WHERE id=$1 FOR UPDATE",
            [input.challengeId],
          )
        ).rows[0];
        if (row.consumed_at)
          throw new Problem(403, "FORBIDDEN", "Challenge déjà consommé.");
        const { challenge, acceptedAt, evidenceRef } = row.evidence;
        const value = (await this.control.grant(
          { challenge, acceptedAt, evidenceRef },
          "grant-" + input.challengeId,
          traceparent,
        )) as Schemas["Mandate"];
        validate("Mandate", value);
        if (
          value.userRef !== user.userRef ||
          value.conversationId !== cid ||
          value.procedureId !== challenge.procedureId ||
          value.scopes.some((scope) => !challenge.scopes.includes(scope))
        )
          throw new Problem(
            503,
            "UPSTREAM_UNAVAILABLE",
            "Mandat retourné incompatible.",
          );
        await db.query(
          "INSERT INTO backend_mandates(id,conversation_id,user_ref,body) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO UPDATE SET body=excluded.body",
          [value.id, cid, user.userRef, value],
        );
        await db.query(
          "UPDATE backend_challenges SET consumed_at=now() WHERE id=$1",
          [input.challengeId],
        );
        await db.query(
          "UPDATE backend_conversations SET actions_paused=false WHERE id=$1",
          [cid],
        );
        await appendEvent(
          db,
          cid,
          envelope({ kind: "mandate.granted", mandate: value }, traceparent),
        );
        return value;
      },
    );
  }
  async revoke(
    user: User,
    cid: string,
    id: string,
    key: string,
    traceparent: string,
  ) {
    return idempotent(
      this.pool,
      [user.userRef, "POST", cid, "revoke", id],
      key,
      {},
      async (db) => {
        await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          cid,
        ]);
        await this.conversations.owner(db, cid, user.userRef);
        const existing = (
          await db.query(
            "SELECT body FROM backend_mandates WHERE id=$1 AND conversation_id=$2 AND user_ref=$3 FOR UPDATE",
            [id, cid, user.userRef],
          )
        ).rows[0];
        if (!existing)
          throw new Problem(404, "NOT_FOUND", "Mandat introuvable.");
        const value = (await this.control.revoke(
          id,
          "revoke-" + id,
          traceparent,
        )) as Schemas["Mandate"];
        validate("Mandate", value);
        if (
          value.id !== id ||
          value.userRef !== user.userRef ||
          value.conversationId !== cid ||
          value.status !== "revoked"
        )
          throw new Problem(
            503,
            "UPSTREAM_UNAVAILABLE",
            "Révocation incompatible.",
          );
        await db.query("UPDATE backend_mandates SET body=$2 WHERE id=$1", [
          id,
          value,
        ]);
        await appendEvent(
          db,
          cid,
          envelope({ kind: "mandate.revoked", mandate: value }, traceparent),
        );
        return value;
      },
    );
  }
}
