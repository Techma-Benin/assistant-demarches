import { test } from "node:test";
import assert from "node:assert/strict";
import { decryptSecret, encryptSecret } from "../dist/apps/backend/src/secrets.js";

test("encryptSecret stores ciphertext that decrypts and never contains the plaintext", () => {
  const env = { CONFIGURATION_SECRETS_KEY: "test-configuration-secret" };
  const plaintext = "sk-never-in-clear";
  const cipher = encryptSecret(plaintext, env);
  assert.equal(cipher.startsWith("v1:"), true);
  assert.equal(cipher.includes(plaintext), false);
  assert.equal(decryptSecret(cipher, env), plaintext);
  assert.throws(() => decryptSecret(cipher, { CONFIGURATION_SECRETS_KEY: "other" }));
});
