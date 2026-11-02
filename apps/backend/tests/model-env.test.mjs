import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveModelFromEnv } from "../dist/apps/backend/src/model-env.js";

test("one provider key selects its endpoint and default model", () => {
  const model = resolveModelFromEnv({ OPENAI_API_KEY: "sk-test" });
  assert.equal(model.apiKeyRef, "OPENAI_API_KEY");
  assert.equal(model.baseUrl, "https://api.openai.com/v1");
  assert.equal(model.model, "gpt-4o-mini");
  assert.equal(model.active, true);
  assert.equal(JSON.stringify(model).includes("sk-test"), false);
});

test("MODEL_NAME overrides the default without changing the key", () => {
  const model = resolveModelFromEnv({ GROQ_API_KEY: "gsk-test", MODEL_NAME: "llama-3.1-8b-instant" });
  assert.equal(model.apiKeyRef, "GROQ_API_KEY");
  assert.equal(model.baseUrl, "https://api.groq.com/openai/v1");
  assert.equal(model.model, "llama-3.1-8b-instant");
});

test("a custom OpenAI-compatible endpoint uses MODEL_API_KEY", () => {
  const model = resolveModelFromEnv({
    MODEL_API_KEY: "secret",
    MODEL_BASE_URL: "https://example.com/v1/",
    MODEL_NAME: "custom-model",
    GROQ_API_KEY: "ignored",
  });
  assert.equal(model.apiKeyRef, "MODEL_API_KEY");
  assert.equal(model.baseUrl, "https://example.com/v1");
  assert.equal(model.model, "custom-model");
});

test("several provider keys require an explicit choice", () => {
  assert.throws(
    () => resolveModelFromEnv({ GROQ_API_KEY: "a", OPENAI_API_KEY: "b" }),
    /Une seule clé modèle/,
  );
  const model = resolveModelFromEnv({
    GROQ_API_KEY: "a",
    OPENAI_API_KEY: "b",
    MODEL_PROVIDER: "openai",
  });
  assert.equal(model.apiKeyRef, "OPENAI_API_KEY");
});

test("no key leaves the operator configuration alone", () => {
  assert.equal(resolveModelFromEnv({}), undefined);
});
