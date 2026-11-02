import { test } from "node:test";
import { isolatedDatabase } from "./helpers.mjs";
import assert from "node:assert/strict";
import { generateKeyPair, exportJWK, createLocalJWKSet, SignJWT } from "jose";
import { createBackend } from "../dist/apps/backend/src/app.js";
import {
  database,
  migrate,
  provision,
} from "../dist/apps/backend/src/database.js";
import { validate } from "../dist/apps/backend/src/domain.js";

test("Backend C3 with isolated PostgreSQL and signed administrator tokens", async (t) => {
  const pg = await isolatedDatabase();
  const pool = database(pg.connection);
  t.after(async () => {
    await pool.end();
    await pg.close();
  });
  await migrate(pool);
  await migrate(pool);
  const model = {
    id: "primary",
    label: "Modèle de test",
    baseUrl: "http://127.0.0.1:9/v1",
    protocol: "chat-completions",
    model: "synthetic-model",
    apiKeyRef: "TEST_PROVIDER_KEY",
    temperature: 0.2,
    active: true,
  };
  const tool = {
    name: "procedures.search",
    enabled: true,
    serverUrl: "http://127.0.0.1:4020/mcp",
    secretRef: "tooling-agent-token",
  };
  await provision(pool, "global", "models", model);
  await provision(pool, "global", "models", { ...model, id: "secondary" });
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const jwk = {
    ...(await exportJWK(publicKey)),
    kid: "test-key",
    alg: "RS256",
  };
  const issuer = "https://identity.example.test/realm";
  const auth = {
    issuer,
    audience: "techma-backend",
    key: createLocalJWKSet({ keys: [jwk] }),
  };
  async function token(overrides = {}) {
    const {
      aud = "techma-backend",
      exp = Math.floor(Date.now() / 1000) + 300,
      alg = "RS256",
      ...claims
    } = overrides;
    return new SignJWT({
      administrationId: "alpha",
      scope: "operator admin:read admin:write",
      ...claims,
    })
      .setProtectedHeader({ alg, kid: "test-key" })
      .setSubject("admin-synthetic")
      .setIssuer(issuer)
      .setAudience(aud)
      .setIssuedAt()
      .setExpirationTime(exp)
      .sign(privateKey);
  }
  const options = {
    pool,
    auth,
    allowedMcpUrls: new Set([tool.serverUrl]),
    corsOrigins: ["https://console.example.test"],
  };
  let app = await createBackend(options);
  await app.listen(0, "127.0.0.1");
  t.after(() => app.close());
  let url = await app.getUrl();
  const bearer = await token();
  const traceparent = "00-" + "1".repeat(32) + "-" + "2".repeat(16) + "-01";
  async function request(
    path,
    {
      method = "GET",
      body,
      authToken = bearer,
      key = "test-key-0001",
      headers = {},
    } = {},
  ) {
    const res = await fetch(url + path, {
      method,
      headers: {
        Authorization: "Bearer " + authToken,
        traceparent,
        ...(key === false ? {} : { "Idempotency-Key": key }),
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const value = res.status === 204 ? null : await res.json();
    if (!res.ok) {
      validate("Problem", value);
      assert.equal(
        res.headers.get("content-type").startsWith("application/problem+json"),
        true,
      );
    }
    return { status: res.status, value };
  }
  await t.test(
    "health, C3 shapes, opaque pagination and tenant isolation",
    async () => {
      assert.equal((await fetch(url + "/health")).status, 200);
      const preflight = await fetch(url + "/v1/operator/models", {
        method: "OPTIONS",
        headers: {
          Origin: "https://console.example.test",
          "Access-Control-Request-Method": "PUT",
          "Access-Control-Request-Headers":
            "authorization,content-type,traceparent,idempotency-key",
        },
      });
      assert.equal(preflight.status, 204);
      assert.equal(
        preflight.headers.get("access-control-allow-origin"),
        "https://console.example.test",
      );
      const first = await request("/v1/operator/models?limit=1");
      assert.equal(first.status, 200);
      validate("ModelConfigPage", first.value);
      assert.ok(first.value.nextCursor);
      const next = await request(
        "/v1/operator/models?limit=1&cursor=" + first.value.nextCursor,
      );
      assert.equal(next.value.items[0].id, "secondary");
      assert.equal(next.value.nextCursor, null);
      const other = await request("/v1/operator/models", {
        authToken: await token({ administrationId: "beta" }),
      });
      assert.equal(other.value.items.length, 2);
      assert.equal(
        (
          await request("/v1/operator/models?cursor=" + first.value.nextCursor, {
            authToken: await token({ administrationId: "beta" }),
          })
        ).status,
        200,
      );
      assert.equal((await request("/v1/operator/models?limit=0")).status, 400);
      assert.equal(
        (await request("/v1/operator/models?limit=1&limit=2")).status,
        400,
      );
      assert.equal(
        (await request("/v1/operator/models?cursor=garbage")).status,
        400,
      );
      const status = await request("/v1/operator/status");
      assert.equal(status.status, 200);
      assert.equal(status.value.model.id, "primary");
    },
  );
  await t.test(
    "JWT verification, scopes, expiry, audience and trace validation",
    async () => {
      assert.equal(
        (await request("/v1/operator/models", { authToken: "mock-admin" })).status,
        401,
      );
      assert.equal(
        (
          await request("/v1/operator/models", {
            authToken: await token({ scope: "tools:call" }),
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await request("/v1/operator/models", {
            authToken: await token({ aud: "wrong" }),
          })
        ).status,
        401,
      );
      assert.equal(
        (
          await request("/v1/operator/models", {
            authToken: await token({ exp: Math.floor(Date.now() / 1000) - 60 }),
          })
        ).status,
        401,
      );
      assert.equal(
        (
          await request("/v1/operator/models", {
            authToken: await token({ scope: "operator" }),
          })
        ).status,
        403,
      );
      const tampered = bearer.split(".");
      tampered[1] = Buffer.from(
        JSON.stringify({ scope: "admin:read", administrationId: "beta" }),
      ).toString("base64url");
      assert.equal(
        (await request("/v1/operator/models", { authToken: tampered.join(".") }))
          .status,
        401,
      );
      assert.equal(
        (await request("/v1/operator/models", { headers: { traceparent: "" } }))
          .status,
        200,
      );
      assert.equal(
        (
          await request("/v1/operator/models", {
            headers: {
              traceparent:
                "00-" + "0".repeat(32) + "-" + "2".repeat(16) + "-01",
            },
          })
        ).status,
        200,
      );
    },
  );
  await t.test(
    "updates persist, concurrent retries create one outbox event, conflicting retries fail",
    async () => {
      const changed = { ...model, model: "another-synthetic-model" };
      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          request("/v1/operator/models/primary", {
            method: "PUT",
            body: changed,
            key: "parallel-key",
          }),
        ),
      );
      for (const result of results) {
        assert.equal(result.status, 200);
        assert.deepEqual(result.value, changed);
        validate("ModelConfig", result.value);
      }
      assert.equal(
        Number(
          (await pool.query("SELECT count(*) FROM backend_outbox")).rows[0]
            .count,
        ),
        1,
      );
      const event = (await pool.query("SELECT event FROM backend_outbox"))
        .rows[0].event;
      assert.equal(event.data.kind, "configuration.changed");
      assert.equal(
        (
          await request("/v1/operator/models/primary", {
            method: "PUT",
            body: model,
            key: "parallel-key",
          })
        ).status,
        409,
      );
      // Reordered JSON properties have the same semantic fingerprint.
      assert.equal(
        (
          await request("/v1/operator/models/primary", {
            method: "PUT",
            body: Object.fromEntries(Object.entries(changed).reverse()),
            key: "parallel-key",
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await request("/v1/operator/models/primary", {
            method: "PUT",
            body: changed,
            authToken: await token({ scope: "admin:read" }),
          })
        ).status,
        403,
      );
      const listed = await request("/v1/operator/models");
      assert.equal(listed.value.items[0].model, changed.model);
      await app.close();
      app = await createBackend(options);
      await app.listen(0, "127.0.0.1");
      url = await app.getUrl();
      assert.equal(
        (await request("/v1/operator/models")).value.items[0].model,
        changed.model,
      );
      assert.equal(
        (
          await request("/v1/operator/models/primary", {
            method: "PUT",
            body: changed,
            key: "parallel-key",
          })
        ).status,
        200,
      );
      assert.equal(
        Number(
          (await pool.query("SELECT count(*) FROM backend_outbox")).rows[0]
            .count,
        ),
        1,
      );
    },
  );
  await t.test(
    "strict inputs, PUT existing semantics, secret references and MCP allowlist",
    async () => {
      for (const body of [
        { ...model, apiKey: "never-store-me" },
        { ...model, temperature: 4 },
      ])
        assert.equal(
          (await request("/v1/operator/models/primary", { method: "PUT", body }))
            .status,
          400,
        );
      assert.equal(
        (
          await request("/v1/operator/models/unknown", {
            method: "PUT",
            body: { ...model, id: "unknown" },
          })
        ).status,
        404,
      );
      assert.equal(
        (
          await request("/v1/operator/models/primary", {
            method: "PUT",
            body: { ...model, id: "wrong" },
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await request("/v1/operator/models/primary", {
            method: "PUT",
            body: model,
            key: "short",
          })
        ).status,
        400,
      );
      assert.equal((await request("/v1/operator/tools")).status, 404);
      assert.equal((await request("/v1/operator/procedures")).status, 404);
      assert.equal((await request("/v1/operator/audit")).status, 404);
      assert.equal((await request("/v1/operator/conversations")).status, 404);
      await pool.query(
        "UPDATE backend_idempotency SET expires_at=now()-interval '1 minute' WHERE key='parallel-key'",
      );
      assert.equal(
        (
          await request("/v1/operator/models/primary", {
            method: "PUT",
            body: model,
            key: "parallel-key",
          })
        ).status,
        200,
      );
    },
  );
  await t.test("activating a model deactivates the others, including under concurrency; deactivating the last remains allowed", async () => {
    const first = { ...model, id: "exclusive-a", model: "one" };
    const second = { ...model, id: "exclusive-b", model: "two" };
    assert.equal((await request("/v1/operator/models", { method: "POST", body: first, key: "exclusive-create-a" })).status, 201);
    assert.equal((await request("/v1/operator/models", { method: "POST", body: second, key: "exclusive-create-b" })).status, 201);
    const afterCreate = await request("/v1/operator/models?limit=100");
    const createdActive = afterCreate.value.items.filter((item) => item.active && item.id.startsWith("exclusive-"));
    assert.equal(createdActive.length, 1);
    assert.equal(createdActive[0].id, "exclusive-b");
    const concurrent = await Promise.all([
      request("/v1/operator/models/exclusive-a", { method: "PUT", body: first, key: "exclusive-conc-a" }),
      request("/v1/operator/models/exclusive-b", { method: "PUT", body: second, key: "exclusive-conc-b" }),
    ]);
    assert.ok(concurrent.every((result) => result.status === 200));
    const afterConcurrent = await request("/v1/operator/models?limit=100");
    const stillActive = afterConcurrent.value.items.filter((item) => item.active);
    assert.equal(stillActive.length, 1);
    assert.equal(
      (await request("/v1/operator/models/exclusive-a", { method: "PUT", body: { ...first, active: false }, key: "exclusive-off-a" })).status,
      200,
    );
    assert.equal(
      (await request("/v1/operator/models/exclusive-b", { method: "PUT", body: { ...second, active: false }, key: "exclusive-off-b" })).status,
      200,
    );
    assert.equal(
      (await request("/v1/operator/models?limit=100")).value.items.filter((item) => item.active && item.id.startsWith("exclusive-")).length,
      0,
    );
  });
  await t.test("CRUD models: creation, detail, scopes, retries and delete/recreate", async () => {
    const body = { ...model, id: "crud-model" };
    const path = "/v1/operator/models";
    const detail = path + "/crud-model";
    const writes = await Promise.all(Array.from({ length: 3 }, () => request(path, { method: "POST", body, key: "crud-create" })));
    for (const result of writes) {
      assert.equal(result.status, 201);
      assert.deepEqual(result.value, body);
    }
    assert.equal((await request(path, { method: "POST", body, key: "crud-collision" })).status, 409);
    assert.deepEqual((await request(detail)).value, body);
    assert.equal((await request(path, { method: "POST", body, authToken: await token({ scope: "admin:read" }) })).status, 403);
    assert.equal((await request(detail, { method: "DELETE", authToken: await token({ scope: "admin:read" }) })).status, 403);
    assert.equal((await request(detail, { authToken: await token({ scope: "admin:write" }) })).status, 403);
    const changed = { ...body, temperature: 0.7 };
    assert.equal((await request(detail, { method: "PUT", body: changed, key: "crud-update" })).status, 200);
    assert.deepEqual((await request(detail)).value, changed);
    const removed = await Promise.all(Array.from({ length: 3 }, () => request(detail, { method: "DELETE", key: "crud-delete" })));
    for (const result of removed) assert.equal(result.status, 204);
    assert.equal((await request(detail)).status, 404);
    assert.equal((await request(detail, { method: "PUT", body: changed, key: "crud-absent-put" })).status, 404);
    assert.equal((await request(path, { method: "POST", body, key: "crud-recreate" })).status, 201);
    assert.equal((await request(detail, { method: "DELETE", key: "crud-delete" })).status, 204);
    assert.deepEqual((await request(detail)).value, body, "replayed DELETE must not remove recreated configuration");
    assert.equal((await request("/v1/operator/models", { method: "POST", body: { ...model, id: "bad", apiKey: "secret" } })).status, 400);
    assert.equal((await request("/v1/operator/models", { method: "POST", body: { ...model, id: "missing-key" }, key: "" })).status, 400);
    assert.equal((await request("/v1/operator/models/primary", { method: "DELETE", key: "" })).status, 400);
    const optional = { ...model, id: "optional-key" };
    assert.equal((await request("/v1/operator/models", { method: "POST", body: optional, key: false })).status, 201);
    assert.equal((await request("/v1/operator/models/optional-key", { method: "PUT", body: { ...optional, temperature: 0.4 }, key: false })).status, 200);
    assert.equal((await request("/v1/operator/models/optional-key", { method: "PUT", body: { ...optional, temperature: 0.5 }, key: "x" })).status, 400);
    assert.equal((await request("/v1/operator/models/optional-key", { method: "DELETE", key: false })).status, 204);
    assert.equal((await request("/v1/operator/models/primary", { method: "DELETE", body: { unexpected: true } })).status, 400);
    for (const rawBody of ["{}", "null"]) {
      const response = await fetch(url + "/v1/operator/models/primary", { method: "DELETE", headers: { Authorization: "Bearer " + bearer, traceparent, "Idempotency-Key": "raw-body-delete", "Content-Type": "application/json" }, body: rawBody });
      assert.equal(response.status, 400);
    }
  });
});
