import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { SignJWT, type CryptoKey, type JWTPayload } from "jose";
import { identifier, Problem } from "./domain.js";
import { scopes } from "./auth.js";

export type User = {
  userRef: string;
  channel: "web" | "whatsapp";
  authenticated: boolean;
  expiresAt: number;
  roles: Set<string>;
};
export function serviceClient(payload: JWTPayload): string {
  return String(payload.azp ?? payload.client_id ?? "");
}

const guestHits = new Map<string, { count: number; reset: number }>();

export class Identities {
  constructor(private pool: Pool) {}
  async issueGuest(
    signing: { key: CryptoKey; kid: string; issuer: string },
    ip: string,
  ): Promise<{ token: string; expiresAt: string }> {
    const now = Date.now();
    const slot = guestHits.get(ip);
    if (!slot || slot.reset < now) guestHits.set(ip, { count: 1, reset: now + 3_600_000 });
    else if (slot.count >= 30)
      throw new Problem(429, "RATE_LIMITED", "Trop de sessions invitées depuis cette adresse.");
    else slot.count += 1;
    const userRef = identifier("usr");
    const digest = createHash("sha256")
      .update(JSON.stringify([signing.issuer, "guest", userRef]))
      .digest("hex");
    await this.pool.query(
      "INSERT INTO backend_identities(identity_hash,user_ref) VALUES($1,$2)",
      [digest, userRef],
    );
    const expiresAt = new Date(now + 86_400_000).toISOString();
    const token = await new SignJWT({ token_use: "guest" })
      .setProtectedHeader({ alg: "RS256", kid: signing.kid })
      .setIssuer(signing.issuer)
      .setAudience("techma-backend")
      .setSubject(userRef)
      .setIssuedAt()
      .setExpirationTime(Math.floor(now / 1000) + 86_400)
      .sign(signing.key);
    return { token, expiresAt };
  }
  async resolve(payload: JWTPayload): Promise<User> {
    const permissions = scopes(payload);
    const client = serviceClient(payload);
    const guest = payload.token_use === "guest";
    const relay = permissions.has("conversation:relay");
    if (
      !guest &&
      !relay &&
      (client === "backend" || client === "tooling" || !permissions.has("citizen"))
    )
      throw new Problem(403, "FORBIDDEN", "Identité usager requise.");
    if (relay && typeof payload.channel_subject !== "string")
      throw new Problem(403, "FORBIDDEN", "Identité de relais incomplète.");
    const channel = relay || payload.channel === "whatsapp" ? "whatsapp" : "web";
    const subject = relay ? String(payload.channel_subject) : String(payload.sub);
    const digest = createHash("sha256")
      .update(JSON.stringify([payload.iss, guest ? "guest" : relay ? "whatsapp" : "citizen", subject]))
      .digest("hex");
    const result = await this.pool.query(
      "INSERT INTO backend_identities(identity_hash,user_ref) VALUES($1,$2) ON CONFLICT(identity_hash) DO UPDATE SET identity_hash=excluded.identity_hash RETURNING user_ref, consumed_at",
      [digest, guest ? subject : identifier("usr")],
    );
    if (guest && result.rows[0].consumed_at)
      throw new Problem(403, "FORBIDDEN", "Session invitée déjà rattachée.");
    return {
      userRef: result.rows[0].user_ref,
      channel,
      authenticated: !guest,
      expiresAt: Number(payload.exp) * 1000,
      roles: permissions,
    };
  }
  async inspectGuest(payload: JWTPayload): Promise<User & { consumed: boolean }> {
    if (payload.token_use !== "guest")
      throw new Problem(400, "INVALID_REQUEST", "Jeton invité requis.");
    const user = await this.resolveAllowConsumed(payload);
    const consumed = (
      await this.pool.query(
        "SELECT consumed_at IS NOT NULL AS consumed FROM backend_identities WHERE user_ref=$1",
        [user.userRef],
      )
    ).rows[0]?.consumed === true;
    return { ...user, consumed };
  }
  async consumeGuest(userRef: string, db: Pick<Pool, "query"> | Pick<PoolClient, "query"> = this.pool): Promise<void> {
    const updated = await db.query(
      "UPDATE backend_identities SET consumed_at=now() WHERE user_ref=$1 AND consumed_at IS NULL RETURNING user_ref",
      [userRef],
    );
    if (!updated.rowCount)
      throw new Problem(409, "CONFLICT", "Session invitée déjà rattachée.");
  }
  private async resolveAllowConsumed(payload: JWTPayload): Promise<User> {
    const permissions = scopes(payload);
    const guest = payload.token_use === "guest";
    const channel = payload.channel === "whatsapp" ? "whatsapp" : "web";
    const subject = String(payload.sub);
    const digest = createHash("sha256")
      .update(JSON.stringify([payload.iss, guest ? "guest" : "citizen", subject]))
      .digest("hex");
    const result = await this.pool.query(
      "INSERT INTO backend_identities(identity_hash,user_ref) VALUES($1,$2) ON CONFLICT(identity_hash) DO UPDATE SET identity_hash=excluded.identity_hash RETURNING user_ref",
      [digest, guest ? subject : identifier("usr")],
    );
    return {
      userRef: result.rows[0].user_ref,
      channel,
      authenticated: !guest,
      expiresAt: Number(payload.exp) * 1000,
      roles: permissions,
    };
  }
}
