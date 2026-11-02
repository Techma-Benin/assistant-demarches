import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { createLocalJWKSet, importPKCS8, jwtVerify, SignJWT } from "jose";
import { privateJwkFields, publicSigningJwk } from "../dist/apps/backend/src/signing-jwks.js";

test("published signing JWKS is public-only and verifies a guest token signed by the private key", async () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" });
  const publicJwk = await publicSigningJwk(pem);
  for (const field of privateJwkFields) assert.equal(publicJwk[field], undefined);
  assert.equal(publicJwk.kty, "RSA");
  assert.ok(publicJwk.n);
  assert.ok(publicJwk.e);
  const signing = await importPKCS8(pem, "RS256");
  const token = await new SignJWT({ token_use: "guest" })
    .setProtectedHeader({ alg: "RS256", kid: "backend-signing" })
    .setIssuer("http://127.0.0.1:4010")
    .setAudience("techma-backend")
    .setSubject("usr_01ARZ3NDEKTSV4RRFFQ69G5FAV")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(signing);
  const { payload } = await jwtVerify(token, createLocalJWKSet({ keys: [publicJwk] }), {
    issuer: "http://127.0.0.1:4010",
    audience: "techma-backend",
    algorithms: ["RS256"],
  });
  assert.equal(payload.token_use, "guest");
});
