import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  generateKeyPair,
  exportJWK,
  createLocalJWKSet,
  SignJWT,
  jwtVerify,
} from "jose";
import { WebSocket } from "ws";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { isolatedDatabase } from "./helpers.mjs";
import {
  database,
  migrate,
  provision,
} from "../dist/apps/backend/src/database.js";
import { createBackend } from "../dist/apps/backend/src/app.js";
import {
  Conversations,
  envelope,
} from "../dist/apps/backend/src/conversations.js";
import { Identities } from "../dist/apps/backend/src/identity.js";
import { Consent, LocalProcedureCatalog } from "../dist/apps/backend/src/consent.js";
import { Files } from "../dist/apps/backend/src/files.js";
import { LocalStorage } from "../dist/apps/backend/src/storage.js";
import {
  McpGateway,
  HttpMandateControl,
  catalog,
} from "../dist/apps/backend/src/tooling.js";
import { HttpModels } from "../dist/apps/backend/src/model.js";
import { Agent } from "../dist/apps/backend/src/agent.js";
import { Delivery } from "../dist/apps/backend/src/delivery.js";
import { identifier, validate } from "../dist/apps/backend/src/domain.js";

const tp = "00-" + "1".repeat(32) + "-" + "2".repeat(16) + "-01";
const fixture = JSON.parse(
  readFileSync(new URL("../../../mocks/fixtures.json", import.meta.url)),
);
test("Real Backend C1/C2/C3/C4: verified identities, durable agent, consent and files", async (t) => {
  const pg = await isolatedDatabase(),
    pool = database(pg.connection);
  const directory = mkdtempSync(join(tmpdir(), "techma-files-test-"));
  t.after(async () => {
    await pool.end();
    await pg.close();
    rmSync(directory, { recursive: true, force: true });
  });
  await migrate(pool);
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const jwks = {
    keys: [{ ...(await exportJWK(publicKey)), kid: "test", alg: "RS256" }],
  };
  const key = createLocalJWKSet(jwks),
    issuer = "https://identity.example.test/realm";
  const auth = { issuer, audience: "techma-backend", key };
  async function token(claims = {}, aud = "techma-backend") {
    return new SignJWT({ administrationId: "alpha", ...claims })
      .setProtectedHeader({ alg: "RS256", kid: "test" })
      .setSubject(claims.sub ?? "portal-user")
      .setIssuer(issuer)
      .setAudience(aud)
      .setIssuedAt()
      .setExpirationTime("10m")
      .sign(privateKey);
  }
  const procedure = {
    ...fixture.schemas.Procedure,
    administrationId: "alpha",
    validationStatus: "validated",
  };
  const secrets = {
    agent: await token(
      { azp: "backend-agent", scope: "tools:call" },
      "techma-tooling",
    ),
    control: await token(
      { azp: "backend-mandates", scope: "mandates:grant" },
      "techma-tooling",
    ),
  };
  const remoteMandates = new Map(),
    grants = new Map(),
    usedProofs = new Set(),
    mcpCalls = [],
    modelCalls = [];
  let remoteGrantCount = 0,
    callbackCount = 0,
    failModel = false,
    failFinalOnce = false;
  const upstream = http.createServer(async (req, res) => {
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = chunks.length
        ? JSON.parse(Buffer.concat(chunks).toString())
        : {};
      if (req.url === "/mcp") {
        const { payload } = await jwtVerify(
          req.headers.authorization?.slice(7) ?? "",
          key,
          { issuer, audience: "techma-tooling", algorithms: ["RS256"] },
        );
        assert.equal(payload.azp, "backend-agent");
        const server = new Server(
          { name: "synthetic-tooling", version: "1.0.0" },
          { capabilities: { tools: {} } },
        );
        server.setRequestHandler(ListToolsRequestSchema, async () => ({
          tools: catalog,
        }));
        server.setRequestHandler(CallToolRequestSchema, async (call) => {
          mcpCalls.push({
            name: call.params.name,
            args: call.params.arguments,
            userRef: req.headers["x-user-ref"],
            conversationId: req.headers["x-conversation-id"],
            key: req.headers["idempotency-key"],
          });
          assert.ok(req.headers["x-user-ref"].startsWith("usr_"));
          assert.equal(req.headers.traceparent, tp);
          let result;
          if (call.params.name === "procedures.get") result = procedure;
          else if (call.params.name === "procedures.search")
            result = { items: [procedure], nextCursor: null };
          else
            return {
              isError: true,
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    code: "MANDATE_MISSING",
                    detail: "Synthetic action denied",
                    traceId: "1".repeat(32),
                  }),
                },
              ],
            };
          return {
            structuredContent: result,
            content: [{ type: "text", text: JSON.stringify(result) }],
          };
        });
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
          enableJsonResponse: true,
        });
        res.on("close", () => {
          void transport.close();
          void server.close();
        });
        await server.connect(transport);
        await transport.handleRequest(req, res, body);
        return;
      }
      if (req.url === "/internal/v1/mandates") {
        const { payload } = await jwtVerify(
          req.headers.authorization?.slice(7) ?? "",
          key,
          { issuer, audience: "techma-tooling" },
        );
        assert.equal(payload.azp, "backend-mandates");
        const idem = req.headers["idempotency-key"];
        if (grants.has(idem)) {
          res.writeHead(201, { "content-type": "application/json" });
          res.end(JSON.stringify(grants.get(idem)));
          return;
        }
        validate("MandateGrant", body);
        const proof = await jwtVerify(body.challenge.proofToken, key, {
          audience: "techma-mandate",
          issuer,
          algorithms: ["RS256"],
        });
        assert.equal(proof.payload.sub, body.challenge.userRef);
        assert.equal(proof.payload.jti, body.challenge.id);
        assert.deepEqual(proof.payload.scopes, body.challenge.scopes);
        assert.equal(usedProofs.has(proof.payload.jti), false);
        usedProofs.add(proof.payload.jti);
        const mandate = {
          id: identifier("mdt"),
          conversationId: body.challenge.conversationId,
          userRef: body.challenge.userRef,
          procedureId: body.challenge.procedureId,
          scopes: body.challenge.scopes,
          status: "active",
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
        };
        remoteMandates.set(mandate.id, mandate);
        grants.set(idem, mandate);
        remoteGrantCount++;
        res.writeHead(201, { "content-type": "application/json" });
        res.end(JSON.stringify(mandate));
        return;
      }
      if (
        req.url?.startsWith("/internal/v1/mandates/") &&
        req.url.endsWith("/revoke")
      ) {
        const { payload } = await jwtVerify(
          req.headers.authorization?.slice(7) ?? "",
          key,
          { issuer, audience: "techma-tooling" },
        );
        assert.equal(payload.azp, "backend-mandates");
        const id = req.url.split("/")[4];
        const mandate = { ...remoteMandates.get(id), status: "revoked" };
        remoteMandates.set(id, mandate);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(mandate));
        return;
      }
      if (req.url === "/v1/chat/completions") {
        modelCalls.push(body);
        if (failModel) {
          res.writeHead(503);
          res.end("{}");
          return;
        }
        const last = body.messages.at(-1);
        if (last.role === "tool" && failFinalOnce) {
          failFinalOnce = false;
          res.writeHead(503);
          res.end("{}");
          return;
        }
        const message =
          last.role === "tool"
            ? {
                content: JSON.stringify({
                  blocks: [
                    {
                      type: "text",
                      text: "Réponse synthétique pour le test.",
                      sources: [procedure.source],
                    },
                  ],
                }),
              }
            : {
                content: null,
                tool_calls: [
                  {
                    id: "call-synthetic",
                    type: "function",
                    function: {
                      name: "procedures_get",
                      arguments: JSON.stringify({ procedureId: procedure.id }),
                    },
                  },
                ],
              };
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ choices: [{ message }] }));
        return;
      }
      if (req.url === "/v1/responses") {
        modelCalls.push(body);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            output: [
              { type: "reasoning", id: "reasoning-test", summary: [] },
              {
                type: "message",
                role: "assistant",
                content: [{ type: "output_text", text: '{"blocks":[]}' }],
              },
            ],
          }),
        );
        return;
      }
      if (req.url === "/callback") {
        const { payload } = await jwtVerify(
          req.headers.authorization?.slice(7) ?? "",
          key,
          { issuer, audience: "whatsapp-adapter" },
        );
        assert.equal(payload.azp, "backend-delivery");
        validate("Event", body);
        callbackCount++;
        res.writeHead(204);
        res.end();
        return;
      }
      res.writeHead(404);
      res.end("{}");
    } catch (error) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: error.message }));
    }
  });
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  t.after(
    () =>
      new Promise((resolve) => {
        upstream.closeAllConnections();
        upstream.close(resolve);
      }),
  );
  const remote = "http://127.0.0.1:" + upstream.address().port;
  const conversations = new Conversations(pool),
    identities = new Identities(
      pool,
      "synthetic-identity-secret-32-characters",
      "alpha",
    );
  const files = new Files(pool, new LocalStorage(directory));
  const consent = new Consent(
    pool,
    conversations,
    new HttpMandateControl(remote, async () => secrets.control),
    { key: privateKey, kid: "test", issuer },
    new LocalProcedureCatalog(pool),
  );
  const runtime = { pool, auth, identities, conversations, files, consent };
  const options = {
    pool,
    auth,
    allowedMcpUrls: new Set([remote + "/mcp"]),
    corsOrigins: ["https://portal.example.test"],
    runtime,
  };
  let app = await createBackend(options);
  await app.listen(0, "127.0.0.1");
  let base = await app.getUrl();
  t.after(() => app.close());
  const portal = await token(),
    other = await token({ sub: "another-user" }),
    admin = await token({ scope: "admin:read admin:write", sub: "admin" });
  const eventsToken = await token({
      azp: "tooling-events",
      scope: "events:publish",
    }),
    resourcesToken = await token({
      azp: "tooling-resources",
      scope: "resources:read",
    });
  async function request(
    path,
    {
      method = "GET",
      body,
      bearer = portal,
      idempotency = randomUUID(),
      headers = {},
    } = {},
  ) {
    const binary = Buffer.isBuffer(body);
    const res = await fetch(base + path, {
      method,
      headers: {
        Authorization: "Bearer " + bearer,
        traceparent: tp,
        "Idempotency-Key": idempotency,
        ...(body
          ? {
              "Content-Type": binary
                ? "application/octet-stream"
                : "application/json",
            }
          : {}),
        ...headers,
      },
      body: body ? (binary ? body : JSON.stringify(body)) : undefined,
    });
    const value = await res.json();
    if (!res.ok) validate("Problem", value);
    return { status: res.status, value };
  }
  await provision(pool, "alpha", "models", {
    id: "main",
    provider: "synthetic",
    model: "test-model",
    promptVersion: "agent-v1",
    temperature: 0,
    active: true,
  });
  await provision(pool, "alpha", "tools", {
    name: "procedures.get",
    enabled: true,
    serverUrl: remote + "/mcp",
    secretRef: "backend-agent",
  });
  await provision(pool, "alpha", "procedures", procedure);
  const models = new HttpModels({
    synthetic: { baseUrl: remote + "/v1/", protocol: "chat-completions" },
  });
  const gateway = new McpGateway(
    new Set([remote + "/mcp"]),
    async () => secrets.agent,
  );
  const agent = new Agent(pool, conversations, models, gateway, consent);
  let c;
  await t.test(
    "C1 channel identity, ownership and message deduplication",
    async () => {
      const create = { channel: "web", locale: "fr" },
        idempotency = randomUUID();
      const first = await request("/v1/conversations", {
        method: "POST",
        body: create,
        idempotency,
      });
      assert.equal(first.status, 201);
      validate("Conversation", first.value);
      c = first.value;
      assert.deepEqual(
        await request("/v1/conversations", {
          method: "POST",
          body: create,
          idempotency,
        }),
        first,
      );
      assert.equal(
        (
          await request("/v1/conversations", {
            method: "POST",
            body: { channel: "whatsapp", locale: "fr" },
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await request("/v1/conversations/" + c.id + "/events", {
            bearer: other,
          })
        ).status,
        404,
      );
      const body = {
        id: identifier("msg"),
        content: {
          type: "text",
          text: "Démarche de test. Mon email est synthetic@example.test et mon NPI 1234567890.",
        },
        sentAt: new Date().toISOString(),
      };
      const path = "/v1/conversations/" + c.id + "/messages";
      assert.equal((await request(path, { method: "POST", body })).status, 202);
      assert.equal((await request(path, { method: "POST", body })).status, 202);
      assert.equal(
        (
          await request(path, {
            method: "POST",
            body: { ...body, content: { type: "text", text: "Changed" } },
          })
        ).status,
        409,
      );
      assert.equal(
        (
          await request(path, {
            method: "POST",
            body: { ...body, userRef: c.userRef },
          })
        ).status,
        400,
      );
      const page = (await request("/v1/conversations/" + c.id + "/events"))
        .value;
      assert.equal(page.items.length, 1);
      assert.equal(page.items[0].data.kind, "message.received");
      assert.equal(
        JSON.stringify(page).includes("synthetic@example.test"),
        false,
      );
    },
  );
  await t.test(
    "Real model HTTP and MCP transport, source checks and durable completion",
    async () => {
      await agent.process(c.id);
      const page = (await request("/v1/conversations/" + c.id + "/events"))
        .value;
      validate("EventPage", page);
      page.items.forEach((event) => validate("Event", event));
      const replies = page.items.filter(
        (event) => event.data.kind === "message.sent",
      );
      assert.equal(replies.length, 1);
      assert.equal(
        replies[0].data.message.blocks[0].sources[0].url,
        procedure.source.url,
      );
      assert.equal(mcpCalls.length, 1);
      assert.equal(mcpCalls[0].userRef, c.userRef);
      assert.equal(JSON.stringify(modelCalls).includes(c.userRef), false);
      assert.equal(
        JSON.stringify(modelCalls).includes("synthetic@example.test"),
        false,
      );
      assert.equal(JSON.stringify(modelCalls).includes("1234567890"), false);
      await agent.process(c.id);
      assert.equal(mcpCalls.length, 1);
      const more = await request(
        "/v1/conversations/" + c.id + "/events?cursor=" + page.items.at(-1).id,
      );
      assert.deepEqual(more.value.items, []);
      assert.equal(
        (await request("/v1/conversations/" + c.id + "/events?cursor=unknown"))
          .status,
        410,
      );
      await app.close();
      app = await createBackend(options);
      await app.listen(0, "127.0.0.1");
      base = await app.getUrl();
      assert.equal(
        (await request("/v1/conversations/" + c.id + "/events")).value.items
          .length,
        page.items.length,
      );
    },
  );
  await t.test(
    "Consent proof, independent control identity, replay and revocation",
    async () => {
      const path = "/v1/conversations/" + c.id;
      const challenge = await request(path + "/mandate-challenges", {
        method: "POST",
        body: { procedureId: procedure.id, scopes: ["requests:write"] },
      });
      assert.equal(challenge.status, 201);
      validate("Challenge", challenge.value);
      const proof = await jwtVerify(challenge.value.proofToken, key, {
        issuer,
        audience: "techma-mandate",
      });
      assert.equal(proof.payload.sub, c.userRef);
      const body = { challengeId: challenge.value.id, accepted: true },
        idempotency = randomUUID();
      const grant = await request(path + "/mandates", {
        method: "POST",
        body,
        idempotency,
      });
      assert.equal(grant.status, 201);
      validate("Mandate", grant.value);
      assert.deepEqual(
        await request(path + "/mandates", {
          method: "POST",
          body,
          idempotency,
        }),
        grant,
      );
      assert.equal(remoteGrantCount, 1);
      assert.equal(
        (await request(path + "/mandates", { method: "POST", body })).status,
        403,
      );
      assert.equal(
        (
          await request(path + "/mandates/" + grant.value.id + "/revoke", {
            method: "POST",
            bearer: other,
          })
        ).status,
        404,
      );
      const revoked = await request(
        path + "/mandates/" + grant.value.id + "/revoke",
        { method: "POST" },
      );
      assert.equal(revoked.status, 200);
      assert.equal(revoked.value.status, "revoked");
      assert.equal(remoteMandates.get(grant.value.id).status, "revoked");
    },
  );
  await t.test(
    "C4 authenticated ingestion, cross-owner rejection and request projection",
    async () => {
      const requestBody = {
        ...fixture.schemas.Request,
        id: identifier("req"),
        conversationId: c.id,
        userRef: c.userRef,
      };
      const event = envelope(
        { kind: "request.created", request: requestBody },
        tp,
        "tooling",
      );
      assert.equal(
        (await request("/internal/v1/events", { method: "POST", body: event }))
          .status,
        401,
      );
      assert.equal(
        (
          await request("/internal/v1/events", {
            method: "POST",
            body: event,
            bearer: eventsToken,
          })
        ).status,
        202,
      );
      assert.equal(
        (
          await request("/internal/v1/events", {
            method: "POST",
            body: event,
            bearer: eventsToken,
          })
        ).status,
        202,
      );
      assert.equal(
        (await request("/v1/requests/" + requestBody.id)).value.id,
        requestBody.id,
      );
      assert.equal(
        (await request("/v1/requests/" + requestBody.id, { bearer: other }))
          .status,
        404,
      );
      const bad = envelope(
        {
          kind: "request.created",
          request: {
            ...requestBody,
            id: identifier("req"),
            userRef: identifier("usr"),
          },
        },
        tp,
        "tooling",
      );
      assert.equal(
        (
          await request("/internal/v1/events", {
            method: "POST",
            body: bad,
            bearer: eventsToken,
          })
        ).status,
        403,
      );
      const status = envelope(
        {
          kind: "request.status_changed",
          requestId: requestBody.id,
          conversationId: c.id,
          from: "draft",
          to: "ready",
          at: new Date().toISOString(),
        },
        tp,
        "tooling",
      );
      assert.equal(
        (
          await request("/internal/v1/events", {
            method: "POST",
            body: status,
            bearer: eventsToken,
          })
        ).status,
        202,
      );
      assert.equal(
        (await request("/v1/requests/" + requestBody.id)).value.status,
        "ready",
      );
    },
  );
  await t.test(
    "Private files usable immediately, ownership and expiry",
    async () => {
      const file = await request("/v1/files", {
        method: "POST",
        body: Buffer.from("%PDF synthetic"),
        headers: { "X-File-Mime-Type": "application/pdf" },
      });
      assert.equal(file.status, 201);
      validate("File", file.value);
      assert.equal('scanStatus' in file.value, false);
      const metadata = "/internal/v1/files/" + file.value.id;
      assert.deepEqual((await request(metadata, { bearer: resourcesToken, headers: { "X-User-Ref": c.userRef } })).value.file, file.value);
      assert.equal(
        (
          await request(metadata, {
            bearer: resourcesToken,
            headers: { "X-User-Ref": identifier("usr") },
          })
        ).status,
        404,
      );
      const body = {
        id: identifier("msg"),
        content: { type: "file", fileId: file.value.id },
        sentAt: new Date().toISOString(),
      };
      assert.equal(
        (
          await request("/v1/conversations/" + c.id + "/messages", {
            method: "POST",
            body,
          })
        ).status,
        202,
      );
      await agent.process(c.id);
      // Existing uploads and idempotency replays must survive the contract migration.
      await pool.query("UPDATE backend_files SET body=body || '{\"scanStatus\":\"rejected\"}'::jsonb WHERE id=$1", [file.value.id]);
      await pool.query("UPDATE backend_idempotency SET response=response || '{\"scanStatus\":\"pending\"}'::jsonb WHERE response->>'id'=$1", [file.value.id]);
      await pool.query("DELETE FROM backend_migrations WHERE name='006_remove_file_scan.sql'");
      await migrate(pool);
      assert.deepEqual((await files.metadata(file.value.id, c.userRef)).file, file.value);
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM backend_idempotency WHERE response->>'id'=$1 AND response ? 'scanStatus'", [file.value.id])).rows[0].n, 0);
      await pool.query(
        "UPDATE backend_files SET expires_at=now()-interval '1 second' WHERE id=$1",
        [file.value.id],
      );
      await files.purgeExpired();
      assert.equal(
        (
          await request(metadata, {
            bearer: resourcesToken,
            headers: { "X-User-Ref": c.userRef },
          })
        ).status,
        404,
      );
    },
  );
  await t.test(
    "WebSocket single-use ticket, replay, allowed origin and expiry",
    async () => {
      const ticket = (
        await request("/v1/conversations/" + c.id + "/socket-ticket", {
          method: "POST",
        })
      ).value;
      validate("SocketTicket", ticket);
      const ws = new WebSocket(ticket.url, {
        origin: "https://portal.example.test",
      });
      const message = once(ws, "message");
      await once(ws, "open");
      const [data] = await message;
      validate("Event", JSON.parse(data.toString()));
      ws.close();
      await once(ws, "close");
      const duplicate = new WebSocket(ticket.url, {
        origin: "https://portal.example.test",
      });
      await assert.rejects(once(duplicate, "open"));
      const another = (
        await request("/v1/conversations/" + c.id + "/socket-ticket", {
          method: "POST",
        })
      ).value;
      const forbidden = new WebSocket(another.url, {
        origin: "https://other.example.test",
      });
      await assert.rejects(once(forbidden, "open"));
    },
  );
  await t.test(
    "WhatsApp uses verified relay identity without a login and delivers the callback",
    async () => {
      const relay = await token({
        azp: "whatsapp-adapter",
        scope: "conversation:relay",
        channel_subject: "+2290100000000",
      });
      const first = await request("/v1/conversations", {
        method: "POST",
        bearer: relay,
        body: { channel: "whatsapp", locale: "fr" },
      });
      assert.equal(first.status, 201);
      const sameNumber = await token({
        sub: "different-service-sub",
        azp: "whatsapp-adapter",
        scope: "conversation:relay",
        channel_subject: "+2290100000000",
      });
      const second = await request("/v1/conversations", {
        method: "POST",
        bearer: sameNumber,
        body: { channel: "whatsapp", locale: "fr" },
      });
      assert.equal(first.value.userRef, second.value.userRef);
      const forged = await token({ channel_subject: "+2290100000000" });
      assert.equal(
        (
          await request("/v1/conversations", {
            method: "POST",
            bearer: forged,
            body: { channel: "whatsapp", locale: "fr" },
          })
        ).status,
        403,
      );
      await request("/v1/conversations/" + first.value.id + "/messages", {
        method: "POST",
        bearer: relay,
        body: {
          id: identifier("msg"),
          content: { type: "text", text: "Démarche synthétique" },
          sentAt: new Date().toISOString(),
        },
      });
      await agent.process(first.value.id);
      const delivery = new Delivery(pool, remote + "/callback", () =>
        token(
          { azp: "backend-delivery", scope: "messages:deliver" },
          "whatsapp-adapter",
        ),
      );
      assert.equal(await delivery.next(), true);
      assert.equal(callbackCount, 1);
      assert.equal(await delivery.next(), false);
    },
  );
  await t.test(
    "C3 administration and private resources follow the same contract",
    async () => {
      for (const [name, schema] of [
        ["models", "ModelConfigPage"],
        ["tools", "ToolConfigPage"],
        ["procedures", "ProcedurePage"],
        ["conversations", "ConversationPage"],
        ["audit", "AuditEntryPage"],
        ["metrics", "Metrics"],
      ]) {
        const result = await request("/v1/admin/" + name, { bearer: admin });
        assert.equal(result.status, 200);
        validate(schema, result.value);
      }
      const changed = await request("/v1/admin/procedures/" + procedure.id, {
        method: "PUT",
        bearer: admin,
        body: { ...procedure, summary: "Contenu synthétique modifié" },
      });
      assert.equal(changed.status, 200);
      assert.equal(
        (
          await request(
            "/internal/v1/procedures?query=" + encodeURIComponent("Démarche"),
            { bearer: resourcesToken },
          )
        ).value.items.length,
        1,
      );
      assert.equal(
        (
          await request("/internal/v1/procedures/" + procedure.id, {
            bearer: resourcesToken,
          })
        ).value.validationStatus,
        "validated",
      );
      assert.equal(
        (await request("/internal/v1/procedures/" + procedure.id)).status,
        401,
      );
    },
  );
  await t.test(
    "Provider failures preserve pending work and Responses adapter preserves output items",
    async () => {
      failModel = true;
      const created = (
        await request("/v1/conversations", {
          method: "POST",
          body: { channel: "web", locale: "fr" },
        })
      ).value;
      await request("/v1/conversations/" + created.id + "/messages", {
        method: "POST",
        body: {
          id: identifier("msg"),
          content: { type: "text", text: "Test interruption" },
          sentAt: new Date().toISOString(),
        },
      });
      await assert.rejects(agent.process(created.id));
      assert.equal(
        (
          await pool.query(
            "SELECT processed_at FROM backend_messages WHERE conversation_id=$1",
            [created.id],
          )
        ).rows[0].processed_at,
        null,
      );
      failModel = false;
      await agent.process(created.id);
      assert.equal(
        (
          await request("/v1/conversations/" + created.id + "/events")
        ).value.items.filter((event) => event.data.kind === "message.sent")
          .length,
        1,
      );
      const retry = (
        await request("/v1/conversations", {
          method: "POST",
          body: { channel: "web", locale: "fr" },
        })
      ).value;
      await request("/v1/conversations/" + retry.id + "/messages", {
        method: "POST",
        body: {
          id: identifier("msg"),
          content: { type: "text", text: "Test checkpoint après outil" },
          sentAt: new Date().toISOString(),
        },
      });
      const before = mcpCalls.length;
      failFinalOnce = true;
      await agent.process(retry.id);
      assert.equal(mcpCalls.length, before + 1);
      await agent.process(retry.id);
      assert.equal(mcpCalls.length, before + 1);
      const responses = new HttpModels({
        synthetic: {
          baseUrl: remote + "/v1/",
          protocol: "responses",
          omitTemperature: true,
        },
      });
      const config = {
        provider: "synthetic",
        model: "test-model",
        promptVersion: "agent-v1",
        temperature: 0,
        active: true,
        id: "test",
      };
      const first = await responses.generate(
        config,
        [{ role: "user", content: "test" }],
        [],
      );
      await responses.generate(
        config,
        [
          { role: "user", content: "test" },
          {
            role: "assistant",
            content: first.text,
            rawOutput: first.rawOutput,
          },
        ],
        [],
      );
      assert.equal(
        modelCalls.at(-1).input.some((item) => item.type === "reasoning"),
        true,
      );
      assert.equal("temperature" in modelCalls.at(-1), false);
    },
  );
  await t.test(
    "STOP pauses new actions immediately and revokes the authoritative mandate outside the model",
    async () => {
      const path = "/v1/conversations/" + c.id;
      const challenge = (
        await request(path + "/mandate-challenges", {
          method: "POST",
          body: { procedureId: procedure.id, scopes: ["requests:write"] },
        })
      ).value;
      const grant = (
        await request(path + "/mandates", {
          method: "POST",
          body: { challengeId: challenge.id, accepted: true },
        })
      ).value;
      const calls = modelCalls.length;
      await request(path + "/messages", {
        method: "POST",
        body: {
          id: identifier("msg"),
          content: { type: "text", text: "STOP" },
          sentAt: new Date().toISOString(),
        },
      });
      assert.equal(
        (
          await pool.query(
            "SELECT actions_paused FROM backend_conversations WHERE id=$1",
            [c.id],
          )
        ).rows[0].actions_paused,
        true,
      );
      await agent.process(c.id);
      assert.equal(remoteMandates.get(grant.id).status, "revoked");
      assert.equal(modelCalls.length, calls);
    },
  );
  await t.test(
    "Model tool results and replay history never expose server identity context",
    async () => {
      await provision(pool, "alpha", "tools", {
        name: "request.status",
        enabled: true,
        serverUrl: remote + "/mcp",
        secretRef: "backend-agent",
      });
      const owned = {
        ...fixture.schemas.Request,
        id: identifier("req"),
        conversationId: c.id,
        userRef: c.userRef,
      };
      const port = {
        async discover() {
          return catalog;
        },
        async call(_url, _secret, name, _args, context) {
          assert.equal(name, "request.status");
          assert.equal(context.userRef, c.userRef);
          return {
            structuredContent: owned,
            content: [{ type: "text", text: JSON.stringify(owned) }],
          };
        },
      };
      let calls = 0;
      const model = {
        async generate(_config, history) {
          const serialized = JSON.stringify(history);
          assert.equal(serialized.includes(c.userRef), false);
          assert.equal(serialized.includes(c.id), false);
          calls++;
          return calls % 2 === 1
            ? {
                text: "",
                calls: [
                  {
                    id: "status-call",
                    name: "request.status",
                    arguments: JSON.stringify({ requestId: owned.id }),
                  },
                ],
              }
            : {
                text: JSON.stringify({
                  blocks: [{ type: "statusCard", request: { id: owned.id } }],
                }),
                calls: [],
              };
        },
      };
      const reader = new Agent(pool, conversations, model, port, consent);
      for (let repeat = 0; repeat < 2; repeat++) {
        await request("/v1/conversations/" + c.id + "/messages", {
          method: "POST",
          body: {
            id: identifier("msg"),
            content: { type: "text", text: "Statut synthétique" },
            sentAt: new Date().toISOString(),
          },
        });
        await reader.process(c.id);
        const page = (await request("/v1/conversations/" + c.id + "/events"))
          .value;
        const block = page.items
          .filter((event) => event.data.kind === "message.sent")
          .at(-1).data.message.blocks[0];
        assert.equal(block.type, "statusCard");
        assert.equal(block.request.userRef, c.userRef);
      }
      assert.equal(
        modelCalls.find((body) => body.tools?.length)?.tools[0].function.name,
        "procedures_get",
      );
    },
  );
  await t.test(
    "Malformed JSON and oversized files keep the contractual HTTP errors",
    async () => {
      const broken = await fetch(base + "/v1/conversations", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + portal,
          traceparent: tp,
          "Idempotency-Key": randomUUID(),
          "Content-Type": "application/json",
        },
        body: "{invalid",
      });
      assert.equal(broken.status, 400);
      validate("Problem", await broken.json());
      const oversized = await request("/v1/files", {
        method: "POST",
        body: Buffer.alloc(10485761),
        headers: { "X-File-Mime-Type": "application/pdf" },
      });
      assert.equal(oversized.status, 413);
      assert.equal(oversized.value.code, "FILE_TOO_LARGE");
    },
  );
});
