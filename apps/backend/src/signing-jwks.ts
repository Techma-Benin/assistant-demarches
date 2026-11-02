import { createPublicKey } from "node:crypto";
import { exportJWK, type JWK } from "jose";

const PRIVATE_FIELDS = ["d", "p", "q", "dp", "dq", "qi"] as const;

export async function publicSigningJwk(pem: string, kid = "backend-signing"): Promise<JWK> {
  const jwk = await exportJWK(createPublicKey(pem));
  for (const field of PRIVATE_FIELDS) delete jwk[field];
  jwk.alg = "RS256";
  jwk.use = "sig";
  jwk.kid = kid;
  return jwk;
}

export const privateJwkFields = PRIVATE_FIELDS;
