import { createHmac } from "node:crypto";
import type { Pool } from "pg";
import type { JWTPayload } from "jose";
import { identifier, Problem } from "./domain.js";
import { scopes } from "./auth.js";

export type User = {
  userRef: string;
  administrationId: string;
  channel: "portal" | "whatsapp";
  expiresAt: number;
};
export function serviceClient(payload: JWTPayload): string {
  return String(payload.azp ?? payload.client_id ?? "");
}
export class Identities {
  constructor(
    private pool: Pool,
    private secret: string,
    private defaultAdministration: string,
  ) {
    if (secret.length < 32)
      throw new Error("Identity HMAC key must contain at least 32 characters.");
  }
  async resolve(payload: JWTPayload): Promise<User> {
    const client = serviceClient(payload),
      permissions = scopes(payload);
    const relay = client === "whatsapp-adapter";
    if (
      relay &&
      (!permissions.has("conversation:relay") ||
        typeof payload.channel_subject !== "string" ||
        !/^\+[1-9]\d{6,14}$/.test(payload.channel_subject))
    )
      throw new Problem(
        403,
        "FORBIDDEN",
        "Identité WhatsApp vérifiée requise.",
      );
    if (
      !relay &&
      (payload.channel_subject !== undefined ||
        [...permissions].some((scope) => scope.startsWith("admin:")) ||
        [
          "backend-agent",
          "backend-mandates",
          "tooling-events",
          "tooling-resources",
        ].includes(client) ||
        (typeof payload.client_id === "string" && !payload.channel_subject))
    )
      throw new Problem(403, "FORBIDDEN", "Identité usager requise.");
    const administrationId =
      typeof payload.administrationId === "string"
        ? payload.administrationId
        : this.defaultAdministration;
    if (!administrationId)
      throw new Problem(403, "FORBIDDEN", "Administration non configurée.");
    const digest = createHmac("sha256", this.secret)
      .update(
        JSON.stringify([
          payload.iss,
          relay ? "whatsapp" : "portal",
          relay ? payload.channel_subject : payload.sub,
        ]),
      )
      .digest("hex");
    const result = await this.pool.query(
      "INSERT INTO backend_identities(identity_hash,user_ref) VALUES($1,$2) ON CONFLICT(identity_hash) DO UPDATE SET identity_hash=excluded.identity_hash RETURNING user_ref",
      [digest, identifier("usr")],
    );
    return {
      userRef: result.rows[0].user_ref,
      administrationId,
      channel: relay ? "whatsapp" : "portal",
      expiresAt: Number(payload.exp) * 1000,
    };
  }
}
