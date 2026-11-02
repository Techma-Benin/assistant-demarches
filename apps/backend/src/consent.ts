import type { Pool } from "pg";
import { createHash, randomBytes } from "node:crypto";
import { SignJWT, type CryptoKey } from "jose";
import { canonical, fingerprint, identifier, validate, Problem, type Schemas } from "./domain.js";
import { Conversations, appendEvent, envelope } from "./conversations.js";
import { idempotent, transaction } from "./transactions.js";
import type { User } from "./identity.js";
import { catalog, type MandateControl, type ToolingPort } from "./tooling.js";
import type { McpServer } from "./mcp-connections.js";

export type ProcedureLookup = {
  get(procedureId: string, context: { administrationId: string; conversationId: string; userRef: string }, key: string): Promise<Schemas["Procedure"]>;
};

/** Explicit compatibility adapter for deployments still using local fiches. */
export class LocalProcedureCatalog implements ProcedureLookup {
  constructor(private pool: Pool) {}
  async get(procedureId: string, context: { administrationId: string }) {
    const value = (await this.pool.query(
      "SELECT body FROM backend_configurations WHERE administration_id=$1 AND resource='procedures' AND resource_id=$2 AND body->'filing' IS NOT NULL AND body->'filing' <> 'null'::jsonb",
      [context.administrationId, procedureId],
    )).rows[0]?.body;
    if (!value) throw new Problem(404, "NOT_FOUND", "Démarche validée introuvable.");
    validate("Procedure", value);
    if (value.id !== procedureId || value.source.procedureId !== procedureId || !value.filing) throw new Problem(503, "UPSTREAM_UNAVAILABLE", "Référence de démarche incompatible.");
    return value;
  }
}

/** The production source of truth is the approved procedures.get MCP tool. */
export class McpProcedureCatalog implements ProcedureLookup {
  constructor(private pool: Pool, private tooling: ToolingPort) {}
  async get(procedureId: string, context: { administrationId: string; conversationId: string; userRef: string }, key: string) {
    const connections = (await this.pool.query(
      "SELECT s.body AS server,t.definition FROM backend_mcp_servers s JOIN backend_mcp_tools t ON t.administration_id=s.administration_id AND t.server_id=s.id WHERE s.administration_id=$1 AND s.body->>'enabled'='true' AND s.body->>'policy'='techma' AND t.name='procedures.get' AND t.enabled=true ORDER BY s.id",
      [context.administrationId],
    )).rows;
    if (!connections.length) throw new Problem(503, "UPSTREAM_UNAVAILABLE", "Catalogue MCP de démarches non configuré.");
    // Ambiguous authoritative catalogues need an operator decision, not random routing.
    if (connections.length !== 1) throw new Problem(503, "UPSTREAM_UNAVAILABLE", "Un unique catalogue MCP de démarches est requis.");
    const server = connections[0].server as McpServer;
    const toolContext = { conversationId: context.conversationId, userRef: context.userRef, traceparent: "00-" + randomBytes(16).toString("hex") + "-" + randomBytes(8).toString("hex") + "-01" };
    const remote = (await this.tooling.discover(server.url, server.auth, toolContext)).find(tool => tool.name === "procedures.get");
    // Tooling v2 inlines $defs on tools/list; the published catalogue is the contract, not the listed envelope.
    if (!remote || !catalog.find(tool => tool.name === "procedures.get"))
      throw new Problem(503, "UPSTREAM_UNAVAILABLE", "Le catalogue MCP doit être redécouvert et approuvé.");
    const result = await this.tooling.call(server.url, server.auth, "procedures.get", { procedureId }, toolContext, "catalogue-" + createHash("sha256").update(key).digest("hex"), catalog.find(tool => tool.name === "procedures.get"));
    if (result.isError) throw new Problem(404, "NOT_FOUND", "Démarche validée introuvable.");
    const value = result.structuredContent;
    validate("Procedure", value);
    const procedure = value as Schemas["Procedure"];
    if (!procedure.filing || procedure.id !== procedureId || procedure.source.procedureId !== procedureId) throw new Problem(404, "NOT_FOUND", "Démarche validée introuvable.");
    return procedure;
  }
}

export class Consent {
  constructor(
    private pool: Pool,
    private conversations: Conversations,
    private control: MandateControl,
    private signing: { key: CryptoKey; kid: string; issuer: string },
    private procedures?: ProcedureLookup,
  ) {}
  async challenge(
    user: User,
    cid: string,
    input: { procedureId: string; scopes: Schemas["Scope"][] },
    key: string,
  ) {
    if (!input?.procedureId || !Array.isArray(input.scopes) || !input.scopes.length)
      throw new Problem(400, "INVALID_REQUEST", "Challenge incomplet.");
    const scope = [user.userRef, "POST", cid, "consent-challenge"];
    // Avoid holding a database transaction/connection while discovering and
    // calling a remote catalogue. Completed retries still reuse their challenge.
    const owned = (await this.pool.query(
      "SELECT administration_id FROM backend_conversations WHERE id=$1 AND user_ref=$2",
      [cid, user.userRef],
    )).rows[0];
    if (!owned) throw new Problem(404, "NOT_FOUND", "Conversation introuvable.");
    const cached = (await this.pool.query(
      "SELECT fingerprint,response FROM backend_idempotency WHERE scope=$1 AND key=$2 AND expires_at>now()",
      [canonical(scope), key],
    )).rows[0];
    if (cached) {
      if (cached.fingerprint !== fingerprint(input)) throw new Problem(409, "IDEMPOTENCY_CONFLICT", "Clé réutilisée pour un contenu différent.");
      return cached.response as Schemas["Challenge"];
    }
    if (!this.procedures) throw new Problem(503, "UPSTREAM_UNAVAILABLE", "Catalogue de consentement non configuré.");
    const procedure = await this.procedures.get(input.procedureId, { administrationId: owned.administration_id, conversationId: cid, userRef: user.userRef }, cid + "-" + key);
    return idempotent(
      this.pool,
      scope,
      key,
      input,
      async (db) => {
        await this.conversations.owner(db, cid, user.userRef);
        const id = identifier("chl"),
          exp = Math.floor(Date.now() / 1000) + 300;
        const scopeLabels: Record<Schemas["Scope"], string> = {
          "requests:write": "préparer et modifier votre dossier",
          "documents:write": "ajouter vos pièces au dossier",
          "requests:submit": "déposer votre dossier auprès du service administratif",
        };
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
            "Autoriser, pendant une heure, les actions suivantes pour « " +
            procedure.title +
            " » : " +
            input.scopes.map(scope => scopeLabels[scope]).join(" ; ") +
            ". Cette autorisation couvre uniquement les actions indiquées ; le paiement exige une confirmation distincte.",
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
    input: Schemas["ConsentInput"],
    key: string,
    traceparent: string,
  ) {
    validate("ConsentInput", input);
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
          user.userRef,
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
