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
    "strict inputs, PUT existing semantics, secret references and MCP allowlist",
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
  await t.test("CRUD configurations: creation, detail, tenant isolation, retries and delete/recreate", async () => {
    const procedure = {
      id: "crud-procedure", administrationId: "alpha", title: "Test", summary: "Test",
      requiredDocuments: [], feeFcfa: 0, processingDays: 1,
      source: { procedureId: "crud-procedure", url: "https://example.org/test", retrievedAt: new Date().toISOString(), version: "1" },
      validationStatus: "draft", formSchema: {type: "object", additionalProperties: false},
    };
    for (const [resource, body] of [["models", {...model,id:"crud-model"}], ["tools",{...tool,name:"crud.tool"}], ["procedures",procedure]]) {
      const path = "/v1/admin/" + resource, id = body.id ?? body.name, detail = path + "/" + id;
      const before = Number((await pool.query("SELECT count(*) FROM backend_outbox")).rows[0].count);
      const writes = await Promise.all(Array.from({length:3}, () => request(path,{method:"POST",body,key:"crud-create"})));
      for (const result of writes) {assert.equal(result.status,201);assert.deepEqual(result.value,body);}
      assert.equal((await request(path,{method:"POST",body,key:"crud-collision"})).status,409);
      assert.equal((await request(path,{method:"POST",body:{...body,...(resource==="models"?{temperature:0.8}:resource==="tools"?{enabled:false}:{title:"changed"})},key:"crud-create"})).status,409);
      assert.deepEqual((await request(detail)).value,body);
      const beta = await token({administrationId:"beta"});
      assert.equal((await request(detail,{authToken:beta})).status,404);
      assert.equal((await request(detail,{method:"DELETE",authToken:beta,key:"crud-delete"})).status,404);
      const betaBody=resource==="procedures"?{...body,administrationId:"beta"}:body;
      const betaCreated=await request(path,{method:"POST",body:betaBody,authToken:beta,key:"crud-create"});
      if(resource === "procedures") {
        assert.equal(betaCreated.status,409,"procedure identifiers are globally unique for the Tooling resource API");
        assert.equal((await request(detail,{authToken:beta})).status,404);
      } else {
        assert.equal(betaCreated.status,201);
        assert.deepEqual((await request(detail)).value,body);
        assert.deepEqual((await request(detail,{authToken:beta})).value,betaBody);
        assert.equal((await request(detail,{method:"DELETE",authToken:beta,key:"crud-delete"})).status,204);
      }
      assert.equal((await request(path,{method:"POST",body,authToken:await token({scope:"admin:read"})})).status,403);
      assert.equal((await request(detail,{method:"DELETE",authToken:await token({scope:"admin:read"})})).status,403);
      assert.equal((await request(detail,{authToken:await token({scope:"admin:write"})})).status,403);
      const changed={...body,...(resource==="models"?{temperature:0.7}:resource==="tools"?{enabled:false}:{title:"Updated"})};
      assert.equal((await request(detail,{method:"PUT",body:changed,key:"crud-update"})).status,200);
      assert.deepEqual((await request(detail)).value,changed);
      const removed=await Promise.all(Array.from({length:3},()=>request(detail,{method:"DELETE",key:"crud-delete"})));
      for (const result of removed) assert.equal(result.status,204);
      assert.equal((await request(detail)).status,404);
      assert.equal((await request(detail,{method:"PUT",body:changed,key:"crud-absent-put"})).status,404);
      assert.equal((await request(detail,{method:"DELETE",key:"crud-absent-delete"})).status,404);
      assert.equal(Number((await pool.query("SELECT count(*) FROM backend_outbox")).rows[0].count),before+(resource === "procedures" ? 3 : 5));
      assert.equal((await request(path,{method:"POST",body,key:"crud-recreate"})).status,201);
      assert.equal((await request(detail,{method:"DELETE",key:"crud-delete"})).status,204);
      assert.deepEqual((await request(detail)).value,body,"replayed DELETE must not remove recreated configuration");
      assert.equal((await request(detail,{method:"DELETE",key:"crud-delete-final"})).status,204);
      const operations=(await pool.query("SELECT event->'data'->>'operation' AS operation FROM backend_outbox WHERE administration_id='alpha' AND event->'data'->>'resourceId'=$1",[id])).rows.map(r=>r.operation);
      assert.deepEqual(operations.sort(),["created","created","deleted","deleted","updated"].sort());
    }
    assert.equal((await request("/v1/admin/models",{method:"POST",body:{...model,id:"bad",apiKey:"secret"}})).status,400);
    assert.equal((await request("/v1/admin/tools",{method:"POST",body:{...tool,name:"bad.tool",serverUrl:"http://169.254.169.254/metadata"}})).status,403);
    assert.equal((await request("/v1/admin/procedures",{method:"POST",body:{...procedure,administrationId:"beta"}})).status,403);
    assert.equal((await request("/v1/admin/procedures",{method:"POST",body:{...procedure,formSchema:{type:"impossible"}}})).status,400);
    assert.equal((await request("/v1/admin/models",{method:"POST",body:{...model,id:"missing-key"},key:""})).status,400);
    assert.equal((await request("/v1/admin/models/primary",{method:"DELETE",key:""})).status,400);
    assert.equal((await request("/v1/admin/models/primary",{method:"DELETE",body:{unexpected:true}})).status,400);
    for (const rawBody of ["{}","null"]) {
      const response=await fetch(url+"/v1/admin/models/primary",{method:"DELETE",headers:{Authorization:"Bearer "+bearer,traceparent,"Idempotency-Key":"raw-body-delete","Content-Type":"application/json"},body:rawBody});
      assert.equal(response.status,400);
    }
    const audit=(await request("/v1/admin/audit?limit=100")).value.items;
    assert.ok(audit.some(entry=>entry.action==="configuration.changed.created"));
    assert.ok(audit.some(entry=>entry.action==="configuration.changed.deleted"));

    // A referenced procedure is protected, without accessing the Tooling database.
    await provision(pool,"alpha","procedures",procedure);
    const conversationId="cnv_"+"0".repeat(26);
    await pool.query("INSERT INTO backend_conversations(id,user_ref,administration_id,body) VALUES ($1,$2,'alpha','{}')",[conversationId,"usr_"+"0".repeat(26)]);
    for (const [table,prefix] of [["backend_challenges","chl"],["backend_mandates","mdt"],["backend_requests","req"]]) {
      const id=prefix+"_"+"0".repeat(26);
      if(table==="backend_requests") await pool.query("INSERT INTO backend_requests(id,conversation_id,user_ref,body,last_event_at) VALUES ($1,$2,$3,$4,now())",[id,conversationId,"usr_"+"0".repeat(26),{procedureId:procedure.id}]);
      else if(table==="backend_mandates") await pool.query("INSERT INTO backend_mandates(id,conversation_id,user_ref,body) VALUES ($1,$2,$3,$4)",[id,conversationId,"usr_"+"0".repeat(26),{procedureId:procedure.id}]);
      else await pool.query("INSERT INTO backend_challenges(id,conversation_id,body) VALUES ($1,$2,$3)",[id,conversationId,{procedureId:procedure.id}]);
      const result=await request("/v1/admin/procedures/"+procedure.id,{method:"DELETE",key:"protected-"+table});
      assert.equal(result.status,409);assert.equal(result.value.code,"INVALID_TRANSITION");
      await pool.query(`DELETE FROM ${table} WHERE id=$1`,[id]);
    }
    assert.equal((await request("/v1/admin/procedures/"+procedure.id,{method:"DELETE",key:"unreferenced-delete"})).status,204);
  });

});
