import { createHash } from "node:crypto";
import { catalog } from "./tooling.js";
import type { Pool } from "pg";
import {
  Problem,
  approvedMcpUrl,
  canonical,
  configId,
  eventId,
  fingerprint,
  validate,
  ajv,
  type Config,
  type Principal,
  type Resource,
} from "./domain.js";

export class Settings {
  constructor(
    readonly pool: Pool,
    private allowedMcpUrls: ReadonlySet<string>,
  ) {}

  async list(
    principal: Principal,
    resource: Resource,
    limit: number,
    cursor?: string,
  ) {
    let after = "";
    if (cursor) {
      try {
        const value = JSON.parse(Buffer.from(cursor, "base64url").toString());
        if (
          value.resource !== resource ||
          value.administrationId !== principal.administrationId ||
          typeof value.after !== "string" ||
          !value.after
        )
          throw new Error();
        after = value.after;
      } catch {
        throw new Problem(400, "INVALID_REQUEST", "Curseur invalide.");
      }
    }
    const { rows } = await this.pool.query(
      "SELECT resource_id, body FROM backend_configurations WHERE administration_id=$1 AND resource=$2 AND resource_id > $3 ORDER BY resource_id LIMIT $4",
      [principal.administrationId, resource, after, limit + 1],
    );
    const page = rows.slice(0, limit);
    return {
      items: page.map((row) => row.body),
      nextCursor:
        rows.length > limit
          ? Buffer.from(
              JSON.stringify({
                resource,
                administrationId: principal.administrationId,
                after: page.at(-1)!.resource_id,
              }),
            ).toString("base64url")
          : null,
    };
  }

  async get(principal: Principal, resource: Resource, id: string) {
    const result = await this.pool.query("SELECT body FROM backend_configurations WHERE administration_id=$1 AND resource=$2 AND resource_id=$3", [principal.administrationId, resource, id]);
    if (!result.rowCount) throw new Problem(404, "NOT_FOUND", "Configuration introuvable.");
    return result.rows[0].body;
  }

  async update(principal: Principal, resource: Resource, id: string, body: Config, key: string, traceparent: string) {
    return this.mutate(principal, resource, id, body, key, traceparent, "PUT");
  }

  async mutate(
    principal: Principal,
    resource: Resource,
    id: string,
    body: Config | null,
    key: string,
    traceparent: string,
    method: "POST" | "PUT" | "DELETE",
  ) {
    if (body !== null) {
      validate(
        resource === "models"
          ? "ModelConfig"
          : resource === "tools"
            ? "ToolConfig"
            : "Procedure",
        body,
      );
      if (resource === "procedures") {
        if (
          !("administrationId" in body) ||
          body.administrationId !== principal.administrationId
        )
          throw new Problem(403, "FORBIDDEN", "Administration incompatible.");
        try {
          ajv.compile(body.formSchema);
        } catch {
          throw new Problem(
            400,
            "INVALID_REQUEST",
            "Schéma de formulaire invalide.",
          );
        }
      }
      if (configId(body) !== id)
        throw new Problem(400, "INVALID_REQUEST", "Identifiant incompatible.");
    }
    const scope = canonical([
      principal.administrationId,
      principal.subject,
      method,
      resource,
      id,
    ]);
    const digest = fingerprint(body);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [canonical([scope, key])],
      );
      const previous = (
        await client.query(
          "SELECT fingerprint, response FROM backend_idempotency WHERE scope=$1 AND key=$2 AND expires_at > now()",
          [scope, key],
        )
      ).rows[0];
      if (previous) {
        if (previous.fingerprint !== digest)
          throw new Problem(
            409,
            "IDEMPOTENCY_CONFLICT",
            "Clé déjà utilisée pour un autre contenu.",
          );
        await client.query("COMMIT");
        return previous.response;
      }
      if (
        body !== null && resource === "tools" &&
        "serverUrl" in body &&
        !approvedMcpUrl(body.serverUrl, this.allowedMcpUrls)
      )
        throw new Problem(
          403,
          "FORBIDDEN",
          "Serveur MCP non autorisé au déploiement.",
        );
      // Serialize all mutations of the same resource, including different keys.
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [canonical([principal.administrationId, resource, id])]);
      const current = (await client.query("SELECT body FROM backend_configurations WHERE administration_id=$1 AND resource=$2 AND resource_id=$3 FOR UPDATE", [principal.administrationId, resource, id])).rows[0];
      if (method === "POST" && current)
        throw new Problem(409, "INVALID_TRANSITION", "Configuration déjà existante.");
      if (method !== "POST" && !current)
        throw new Problem(404, "NOT_FOUND", "Configuration introuvable.");
      if (method === "DELETE" && resource === "procedures") {
        const references = await client.query(`SELECT 1 FROM backend_conversations c WHERE c.administration_id=$1 AND (
          EXISTS (SELECT 1 FROM backend_requests r WHERE r.conversation_id=c.id AND r.body->>'procedureId'=$2) OR
          EXISTS (SELECT 1 FROM backend_mandates m WHERE m.conversation_id=c.id AND m.body->>'procedureId'=$2) OR
          EXISTS (SELECT 1 FROM backend_challenges h WHERE h.conversation_id=c.id AND h.body->>'procedureId'=$2)) LIMIT 1`, [principal.administrationId, id]);
        if (references.rowCount)
          throw new Problem(409, "INVALID_TRANSITION", "Fiche référencée par un dossier ou un consentement ; conserver la fiche.");
      }
      if (method === "POST") {
        const inserted = await client.query("INSERT INTO backend_configurations (administration_id,resource,resource_id,body) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING resource_id", [principal.administrationId,resource,id,body]);
        if (!inserted.rowCount) throw new Problem(409, "INVALID_TRANSITION", "Configuration déjà existante.");
      } else if (method === "PUT")
        await client.query("UPDATE backend_configurations SET body=$4,updated_at=now() WHERE administration_id=$1 AND resource=$2 AND resource_id=$3", [principal.administrationId,resource,id,body]);
      else
        await client.query("DELETE FROM backend_configurations WHERE administration_id=$1 AND resource=$2 AND resource_id=$3", [principal.administrationId,resource,id]);
      if(resource==="tools"){
        // Compatibility bridge for deprecated per-action clients; new clients use mcp-servers.
        const previous=current?.body;
        if(previous && (method==="DELETE" || previous.serverUrl!==(body as any)?.serverUrl || previous.secretRef!==(body as any)?.secretRef)){
          const oldId="mcp_"+createHash("md5").update(previous.serverUrl+String.fromCharCode(31)+previous.secretRef).digest("hex");
          await client.query("DELETE FROM backend_mcp_tools WHERE administration_id=$1 AND server_id=$2 AND name=$3",[principal.administrationId,oldId,id]);
        }
        if(body!==null){const tool=body as any;const serverId="mcp_"+createHash("md5").update(tool.serverUrl+String.fromCharCode(31)+tool.secretRef).digest("hex");
          await client.query("INSERT INTO backend_mcp_servers(administration_id,id,body) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",[principal.administrationId,serverId,{id:serverId,name:"Serveur MCP migré",url:tool.serverUrl,enabled:true,transport:"streamable-http",auth:{type:"bearer",secretRef:tool.secretRef},policy:"techma"}]);
          const definition=catalog.find(t=>t.name===tool.name);
          await client.query("INSERT INTO backend_mcp_tools(administration_id,server_id,name,definition,enabled,requires_mandate) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(administration_id,server_id,name) DO UPDATE SET enabled=excluded.enabled",[principal.administrationId,serverId,tool.name,definition??null,tool.enabled,Boolean(definition?._meta?.["bj.techma/requiresMandate"])]);
        }
      }
      const event = {
        specversion: "1.0",
        id: eventId(),
        source: "urn:techma:backend",
        type: "bj.techma.configuration.changed.v1",
        time: new Date().toISOString(),
        datacontenttype: "application/json",
        traceparent,
        data: {
          kind: "configuration.changed",
          resource,
          resourceId: id,
          actorRef: principal.subject,
          operation: method === "POST" ? "created" : method === "PUT" ? "updated" : "deleted",
        },
      };
      validate("Event", event);
      await client.query(
        "INSERT INTO backend_outbox (id, administration_id, event) VALUES ($1,$2,$3)",
        [event.id, principal.administrationId, event],
      );
      await client.query(
        "INSERT INTO backend_idempotency (scope,key,fingerprint,response) VALUES ($1,$2,$3,$4) ON CONFLICT (scope,key) DO UPDATE SET fingerprint=excluded.fingerprint,response=excluded.response,expires_at=now()+interval '24 hours'",
        [scope, key, digest, JSON.stringify(body)],
      );
      await client.query("COMMIT");
      return body;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async activity(
    principal: Principal,
    resource: "conversations" | "audit",
    limit: number,
    cursor?: string,
  ) {
    let after = "";
    if (cursor) {
      try {
        const decoded = JSON.parse(Buffer.from(cursor, "base64url").toString());
        if (
          decoded.administrationId !== principal.administrationId ||
          decoded.resource !== resource ||
          typeof decoded.after !== "string"
        )
          throw new Error();
        after = decoded.after;
      } catch {
        throw new Problem(400, "INVALID_REQUEST", "Curseur invalide.");
      }
    }
    const rows =
      resource === "conversations"
        ? (
            await this.pool.query(
              "SELECT id,body FROM backend_conversations WHERE administration_id=$1 AND id>$2 ORDER BY id LIMIT $3",
              [principal.administrationId, after, limit + 1],
            )
          ).rows
        : (
            await this.pool.query(
              "SELECT id,event AS body FROM backend_outbox WHERE administration_id=$1 AND id>$2 ORDER BY id LIMIT $3",
              [principal.administrationId, after, limit + 1],
            )
          ).rows;
    const page = rows.slice(0, limit);
    const items =
      resource === "conversations"
        ? page.map((row) => row.body)
        : page.map((row) => ({
            id: row.id,
            actorRef: row.body.data.actorRef,
            action: row.body.data.operation ? `${row.body.data.kind}.${row.body.data.operation}` : row.body.data.kind,
            resourceId: row.body.data.resourceId,
            at: row.body.time,
            traceId: row.body.traceparent.split("-")[1],
          }));
    return {
      items,
      nextCursor:
        rows.length > limit
          ? Buffer.from(
              JSON.stringify({
                administrationId: principal.administrationId,
                resource,
                after: page.at(-1)!.id,
              }),
            ).toString("base64url")
          : null,
    };
  }
  async metrics(principal: Principal) {
    const counts = (
      await this.pool.query(
        "SELECT count(*)::int AS count FROM backend_conversations WHERE administration_id=$1",
        [principal.administrationId],
      )
    ).rows[0];
    const latency = (
      await this.pool.query(
        "SELECT coalesce(percentile_cont(0.95) WITHIN GROUP (ORDER BY extract(epoch FROM (m.processed_at-m.created_at))*1000),0) AS latency,coalesce(sum(m.attempts),0) AS errors FROM backend_messages m JOIN backend_conversations c ON c.id=m.conversation_id WHERE c.administration_id=$1",
        [principal.administrationId],
      )
    ).rows[0];
    const messages = (
      await this.pool.query(
        "SELECT e.body->'data'->'message' AS message FROM backend_conversation_events e JOIN backend_conversations c ON c.id=e.conversation_id WHERE c.administration_id=$1 AND e.body->'data'->>'kind'='message.sent'",
        [principal.administrationId],
      )
    ).rows;
    const sourced = messages.filter((row) =>
      row.message.blocks.some(
        (block: any) => block.type === "text" && block.sources.length > 0,
      ),
    ).length;
    return {
      conversationCount: counts.count,
      p95LatencyMs: Number(latency.latency),
      sourcedAnswerRate: messages.length ? sourced / messages.length : 0,
      errorCount: Number(latency.errors),
    };
  }
}
