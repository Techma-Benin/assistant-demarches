import { readFileSync } from "node:fs";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import type { AuthOptions } from "./auth.js";

/** Only the development launcher creates this fixture; no production token issuer. */
export async function createDevelopmentIdentity(administrationId: string) {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const kid = "local-development";
  const jwks = { keys: [{ ...await exportJWK(publicKey), kid, alg: "RS256", use: "sig" }] };
  const issuer = "urn:techma:local-development";
  const tokens: Record<string, string> = {};
  for (const role of ["user", "admin"]) {
    tokens[role] = await new SignJWT({ administrationId, ...(role === "admin" ? { scope: "admin:read admin:write" } : {}) })
      .setProtectedHeader({ alg: "RS256", kid })
      .setIssuer(issuer).setAudience("techma-backend")
      .setSubject(`local-development-${role}`).setIssuedAt().setExpirationTime("8h").sign(privateKey);
  }
  return { issuer, jwks, tokens };
}

export function loadDevelopmentIdentity(file: string, host: string) {
  if (process.env.NODE_ENV !== "development" || !["127.0.0.1", "localhost", "::1"].includes(host)) {
    throw new Error("Development authentication requires NODE_ENV=development and a loopback HOST.");
  }
  const fixture = JSON.parse(readFileSync(file, "utf8")) as Awaited<ReturnType<typeof createDevelopmentIdentity>>;
  const auth: AuthOptions = { issuer: fixture.issuer, audience: "techma-backend", key: createLocalJWKSet(fixture.jwks) };
  return { auth, tokens: fixture.tokens };
}
