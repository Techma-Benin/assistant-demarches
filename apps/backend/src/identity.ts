import { createHash } from "node:crypto";
import type { Pool } from "pg";
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
      .setExpirationTime(expiresAt)
      .sign(signing.key);
    return { token, expiresAt };
  }
  async resolve(payload: JWTPayload): Promise<User> {
    const permissions = scopes(payload);
    const client = serviceClient(payload);
    const guest = payload.token_use === "guest";
    if (
      !guest &&
      (client === "backend" || client === "tooling" || !permissions.has("citizen"))
    )
      throw new Problem(403, "FORBIDDEN", "Identité usager requise.");
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
