import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTVerifyGetKey,
  type JWTPayload,
} from "jose";
import { Problem, type Principal } from "./domain.js";

export type AuthOptions = {
  issuer: string;
  audience: string;
  key: JWTVerifyGetKey;
};
export function remoteAuth(issuer: string, jwksUrl: string): AuthOptions {
  for (const value of [issuer, jwksUrl]) {
    const url = new URL(value);
    if (
      url.username ||
      url.password ||
      (url.protocol !== "https:" &&
        !(
          url.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
        ))
    )
      throw new Error("OIDC URLs require HTTPS outside localhost.");
  }
  return {
    issuer,
    audience: "techma-backend",
    key: createRemoteJWKSet(new URL(jwksUrl)),
  };
}
export async function authenticate(
  header: string | undefined,
  auth: AuthOptions,
): Promise<Principal> {
  const payload = await verifyIdentity(header, auth);
  if (typeof payload.administrationId !== "string" || !payload.administrationId)
    throw new Problem(403, "FORBIDDEN", "Administration manquante.");
  return {
    subject: payload.sub!,
    administrationId: payload.administrationId,
    scopes: scopes(payload),
  };
}
export const scopes = (payload: JWTPayload): Set<string> => {
  const realm = payload.realm_access as { roles?: unknown } | undefined;
  const roles = Array.isArray(realm?.roles)
    ? realm.roles.filter((role): role is string => typeof role === "string")
    : [];
  return new Set([
    ...(typeof payload.scope === "string" ? payload.scope.split(" ") : []),
    ...roles,
  ]);
};
export async function verifyIdentity(
  header: string | undefined,
  auth: AuthOptions,
): Promise<JWTPayload> {
  const match = /^Bearer (\S+)$/.exec(header ?? "");
  if (!match) throw new Problem(401, "UNAUTHORIZED", "Jeton requis.");
  try {
    const { payload } = await jwtVerify(match[1], auth.key, {
      issuer: auth.issuer,
      audience: auth.audience,
      algorithms: ["RS256"],
      clockTolerance: 30,
      requiredClaims: ["sub", "exp", "iat"],
    });
    if (typeof payload.sub !== "string" || !payload.sub)
      throw new Problem(401, "UNAUTHORIZED", "Sujet manquant.");
    return payload;
  } catch (error) {
    if (error instanceof Problem) throw error;
    throw new Problem(401, "UNAUTHORIZED", "Jeton invalide ou expiré.");
  }
}
