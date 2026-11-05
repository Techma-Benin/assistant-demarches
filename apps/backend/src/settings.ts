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
import { deactivateOtherModels, modelsLockKey } from "./model-env.js";
import { deleteModelSecret, upsertModelSecret } from "./secrets.js";

export function takeModelWrite(body: unknown): { model: Config; apiKey?: string } {
  if (!body || typeof body !== "object") throw new Problem(400, "INVALID_REQUEST", "Corps non conforme au contrat.");
  const record = { ...(body as Record<string, unknown>) };
  const raw = record.apiKey;
  delete record.apiKey;
  if (raw !== undefined && typeof raw !== "string")
    throw new Problem(400, "INVALID_REQUEST", "Clé d’accès invalide.");
  validate("ModelConfig", record);
  const apiKey = typeof raw === "string" && raw.trim() ? raw.trim() : undefined;
  return { model: record as Config, apiKey };
}

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

  async update(principal: Principal, resource: Resource, id: string, body: Config, key: string, traceparent: string, apiKey?: string) {
    return this.mutate(principal, resource, id, body, key, traceparent, "PUT", apiKey);
  }

  async mutate(
    principal: Principal,
    resource: Resource,
    id: string,
    body: Config | null,
    key: string,
    traceparent: string,
    method: "POST" | "PUT" | "DELETE",
    apiKey?: string,
  ) {
    if (body !== null) {
      validate("ModelConfig", body);
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
    const digest = fingerprint(body === null ? null : { body, apiKey: apiKey ?? "" });
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
      // Serialize every model mutation in the administration so exclusive activation stays unique.
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
        modelsLockKey(principal.administrationId),
      ]);
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [canonical([principal.administrationId, resource, id])]);
      const current = (await client.query("SELECT body FROM backend_configurations WHERE administration_id=$1 AND resource=$2 AND resource_id=$3 FOR UPDATE", [principal.administrationId, resource, id])).rows[0];
      if (method === "POST" && current)
        throw new Problem(409, "INVALID_TRANSITION", "Configuration déjà existante.");
      if (method !== "POST" && !current)
        throw new Problem(404, "NOT_FOUND", "Configuration introuvable.");
      if (method === "POST") {
        const inserted = await client.query("INSERT INTO backend_configurations (administration_id,resource,resource_id,body) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING resource_id", [principal.administrationId,resource,id,body]);
        if (!inserted.rowCount) throw new Problem(409, "INVALID_TRANSITION", "Configuration déjà existante.");
      } else if (method === "PUT")
        await client.query("UPDATE backend_configurations SET body=$4,updated_at=now() WHERE administration_id=$1 AND resource=$2 AND resource_id=$3", [principal.administrationId,resource,id,body]);
      else {
        await client.query("DELETE FROM backend_configurations WHERE administration_id=$1 AND resource=$2 AND resource_id=$3", [principal.administrationId,resource,id]);
        await deleteModelSecret(client, principal.administrationId, id);
      }
      if (method !== "DELETE" && resource === "models" && apiKey)
        await upsertModelSecret(client, principal.administrationId, id, apiKey);
      if (method !== "DELETE" && body && "active" in body && body.active)
        await deactivateOtherModels(client, principal.administrationId, id);
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
