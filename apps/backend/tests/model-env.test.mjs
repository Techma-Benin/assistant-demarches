import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveModelFromEnv } from "../dist/apps/backend/src/model-env.js";

test("MODEL_API_KEY alone uses the Groq default", () => {
  const model = resolveModelFromEnv({ MODEL_API_KEY: "secret" });
  assert.equal(model.apiKeyRef, "MODEL_API_KEY");
  assert.equal(model.role, "discussion");
  assert.equal(model.baseUrl, "https://api.groq.com/openai/v1");
  assert.equal(model.model, "qwen/qwen3.8-27b");
  assert.equal(JSON.stringify(model).includes("secret"), false);
});

test("MODEL_PROVIDER switches the endpoint and the default model", () => {
  const model = resolveModelFromEnv({ MODEL_API_KEY: "secret", MODEL_PROVIDER: "openai" });
  assert.equal(model.label, "OpenAI");
  assert.equal(model.baseUrl, "https://api.openai.com/v1");
  assert.equal(model.model, "gpt-4o-mini");
  assert.equal(model.apiKeyRef, "MODEL_API_KEY");
  const gemini = resolveModelFromEnv({ MODEL_API_KEY: "secret", MODEL_PROVIDER: "gemini" });
  assert.equal(gemini.model, "gemini-3.5-flash");
});

test("URL and model name override the provider defaults", () => {
  const model = resolveModelFromEnv({
    MODEL_API_KEY: "secret",
    MODEL_PROVIDER: "groq",
    MODEL_BASE_URL: "https://example.com/v1/",
    MODEL_NAME: "custom-model",
    MODEL_PROTOCOL: "responses",
  });
  assert.equal(model.baseUrl, "https://example.com/v1");
  assert.equal(model.model, "custom-model");
  assert.equal(model.protocol, "responses");
});

test("an unknown provider needs an URL and a model name", () => {
  assert.throws(
    () => resolveModelFromEnv({ MODEL_API_KEY: "secret", MODEL_PROVIDER: "other" }),
    /MODEL_BASE_URL et MODEL_NAME/,
  );
  const model = resolveModelFromEnv({
    MODEL_API_KEY: "secret",
    MODEL_PROVIDER: "other",
    MODEL_BASE_URL: "https://models.example/v1",
    MODEL_NAME: "local",
  });
  assert.equal(model.baseUrl, "https://models.example/v1");
  assert.equal(model.model, "local");
});

test("no key leaves the operator configuration alone", () => {
  assert.equal(resolveModelFromEnv({}), undefined);
});
