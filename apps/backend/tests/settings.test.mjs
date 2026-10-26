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
    provider: "openai-compatible",
    model: "synthetic-model",
    promptVersion: "demo-1",
    temperature: 0.2,
    active: true,
  };
  const tool = {
    name: "procedures.search",
    enabled: true,
    serverUrl: "http://127.0.0.1:4020/mcp",
    secretRef: "tooling-agent-token",
  };
  for (const administration of ["alpha", "beta"]) {
    await provision(pool, administration, "models", model);
    await provision(pool, administration, "tools", tool);
  }
  await provision(pool, "alpha", "models", { ...model, id: "secondary" });
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
      scope: "admin:read admin:write",
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
        "Idempotency-Key": key,
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const value = await res.json();
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
      const preflight = await fetch(url + "/v1/admin/models", {
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
      const first = await request("/v1/admin/models?limit=1");
      assert.equal(first.status, 200);
      validate("ModelConfigPage", first.value);
      assert.ok(first.value.nextCursor);
      const next = await request(
        "/v1/admin/models?limit=1&cursor=" + first.value.nextCursor,
      );
      assert.equal(next.value.items[0].id, "secondary");
      assert.equal(next.value.nextCursor, null);
      const other = await request("/v1/admin/models", {
        authToken: await token({ administrationId: "beta" }),
      });
      assert.equal(other.value.items.length, 1);
      assert.equal(
        (
          await request("/v1/admin/models?cursor=" + first.value.nextCursor, {
            authToken: await token({ administrationId: "beta" }),
          })
        ).status,
        400,
      );
      assert.equal((await request("/v1/admin/models?limit=0")).status, 400);
      assert.equal(
        (await request("/v1/admin/models?limit=1&limit=2")).status,
        400,
      );
      assert.equal(
        (await request("/v1/admin/models?cursor=garbage")).status,
        400,
      );
      validate("ToolConfigPage", (await request("/v1/admin/tools")).value);
    },
  );
  await t.test(
    "JWT verification, scopes, expiry, audience and trace validation",
    async () => {
      assert.equal(
        (await request("/v1/admin/models", { authToken: "mock-admin" })).status,
        401,
      );
      assert.equal(
        (
          await request("/v1/admin/models", {
            authToken: await token({ scope: "tools:call" }),
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await request("/v1/admin/models", {
            authToken: await token({ aud: "wrong" }),
          })
        ).status,
        401,
      );
      assert.equal(
        (
          await request("/v1/admin/models", {
            authToken: await token({ exp: Math.floor(Date.now() / 1000) - 60 }),
          })
        ).status,
        401,
      );
      assert.equal(
        (
          await request("/v1/admin/models", {
            authToken: await token({ administrationId: null }),
          })
        ).status,
        403,
      );
      const tampered = bearer.split(".");
      tampered[1] = Buffer.from(
        JSON.stringify({ scope: "admin:read", administrationId: "beta" }),
      ).toString("base64url");
      assert.equal(
        (await request("/v1/admin/models", { authToken: tampered.join(".") }))
          .status,
        401,
      );
      assert.equal(
        (await request("/v1/admin/models", { headers: { traceparent: "" } }))
          .status,
        400,
      );
      assert.equal(
        (
          await request("/v1/admin/models", {
            headers: {
              traceparent:
                "00-" + "0".repeat(32) + "-" + "2".repeat(16) + "-01",
            },
          })
        ).status,
        400,
      );
    },
  );
  await t.test(
    "updates persist, concurrent retries create one outbox event, conflicting retries fail",
    async () => {
      const changed = { ...model, model: "another-synthetic-model" };
      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          request("/v1/admin/models/primary", {
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
      validate("Event", event);
      assert.equal(event.data.kind, "configuration.changed");
      assert.equal(
        (
          await request("/v1/admin/models/primary", {
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
          await request("/v1/admin/models/primary", {
            method: "PUT",
            body: Object.fromEntries(Object.entries(changed).reverse()),
            key: "parallel-key",
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await request("/v1/admin/models/primary", {
            method: "PUT",
            body: changed,
            authToken: await token({ scope: "admin:read" }),
          })
        ).status,
        403,
      );
      const beta = await request("/v1/admin/models", {
        authToken: await token({ administrationId: "beta" }),
      });
      assert.equal(beta.value.items[0].model, model.model);
      await app.close();
      app = await createBackend(options);
      await app.listen(0, "127.0.0.1");
      url = await app.getUrl();
      assert.equal(
        (await request("/v1/admin/models")).value.items[0].model,
        changed.model,
      );
      assert.equal(
        (
          await request("/v1/admin/models/primary", {
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
    "strict inputs, update-only semantics, secret references and MCP allowlist",
    async () => {
      for (const body of [
        { ...model, apiKey: "never-store-me" },
        { ...model, temperature: 4 },
      ])
        assert.equal(
          (await request("/v1/admin/models/primary", { method: "PUT", body }))
            .status,
          400,
        );
      assert.equal(
        (
          await request("/v1/admin/models/unknown", {
            method: "PUT",
            body: { ...model, id: "unknown" },
          })
        ).status,
        404,
      );
      assert.equal(
        (
          await request("/v1/admin/models/primary", {
            method: "PUT",
            body: { ...model, id: "wrong" },
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await request("/v1/admin/models/primary", {
            method: "PUT",
            body: model,
            key: "short",
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await request("/v1/admin/tools/procedures.search", {
            method: "PUT",
            body: { ...tool, serverUrl: "http://169.254.169.254/metadata" },
            key: "blocked-tool",
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await request("/v1/admin/tools/procedures.search", {
            method: "PUT",
            body: {
              ...tool,
              serverUrl: "https://user:password@example.test/mcp",
            },
            key: "blocked-userinfo",
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await request("/v1/admin/tools/procedures.search", {
            method: "PUT",
            body: { ...tool, enabled: false },
            key: "allowed-tool",
          })
        ).status,
        200,
      );
      const tools = (await request("/v1/admin/tools")).value;
      assert.equal(tools.items[0].enabled, false);
      assert.equal(tools.items[0].secretRef, tool.secretRef);
      const before = Number(
        (await pool.query("SELECT count(*) FROM backend_outbox")).rows[0].count,
      );
      assert.equal(before, 2);
      // A failed write does not reserve the key or create a phantom change event.
      assert.equal(
        Number(
          (
            await pool.query(
              "SELECT count(*) FROM backend_idempotency WHERE key='blocked-tool'",
            )
          ).rows[0].count,
        ),
        0,
      );
      // Expired reservations no longer block a new update.
      await pool.query(
        "UPDATE backend_idempotency SET expires_at=now()-interval '1 minute' WHERE key='parallel-key'",
      );
      assert.equal(
        (
          await request("/v1/admin/models/primary", {
            method: "PUT",
            body: model,
            key: "parallel-key",
          })
        ).status,
        200,
      );
    },
  );
});
