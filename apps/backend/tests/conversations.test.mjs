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
import { RESUME_AFTER_CONSENT, RESUME_AFTER_LOGIN } from "../dist/apps/backend/src/conversations.js";
import { identifier, validate } from "../dist/apps/backend/src/domain.js";

const tp = "00-" + "1".repeat(32) + "-" + "2".repeat(16) + "-01";
const fixture = JSON.parse(
  readFileSync(new URL("../../../contracts/v2/examples.json", import.meta.url)),
);
// POST …/mandates queues a Backend turn that replays the waiting action (covered by v2-journey and
// interface-wiring): the older checks below drive the agent turn by turn and do not want it.
const skipResumes = (pool) =>
  pool.query(
    "UPDATE backend_messages SET processed_at=now() WHERE processed_at IS NULL AND body->'content'->>'text' IN ($1,$2)",
    [RESUME_AFTER_CONSENT, RESUME_AFTER_LOGIN],
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
    return new SignJWT({ administrationId: "alpha", scope: "citizen", ...claims })
      .setProtectedHeader({ alg: "RS256", kid: "test" })
      .setSubject(claims.sub ?? "portal-user")
      .setIssuer(issuer)
      .setAudience(aud)
      .setIssuedAt()
      .setExpirationTime("10m")
      .sign(privateKey);
  }
  const procedure = fixture.schemas.Procedure;
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
          tools: catalog.map(({ name, description, inputSchema }) => ({
            name,
            description,
            inputSchema,
          })),
        }));
        server.setRequestHandler(CallToolRequestSchema, async (call) => {
          mcpCalls.push({
            name: call.params.name,
            args: call.params.arguments,
            userRef: req.headers["x-user-ref"],
            conversationId: req.headers["x-conversation-id"],
            key: req.headers["idempotency-key"],
          });
          assert.ok(String(req.headers["x-user-ref"] ?? "").startsWith("usr_"));
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
        assert.match(String(req.headers["x-user-ref"] ?? ""), /^usr_/);
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
        if (body.stream) {
          const events = message.tool_calls
            ? message.tool_calls.map((call, index) => ({
                choices: [{ delta: { tool_calls: [{ index, id: call.id, type: call.type, function: call.function }] } }],
              }))
            : [{ choices: [{ delta: { content: message.content ?? "" } }] }];
          res.writeHead(200, { "content-type": "text/event-stream" });
          res.end(events.map((event) => `data: ${JSON.stringify(event)}`).join("\n\n") + "\n\ndata: [DONE]\n");
          return;
        }
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
  const runtime = { pool, auth, identities, conversations, files, consent, signing: { key: privateKey, kid: "test", issuer } };
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
      azp: "tooling",
      scope: "events:publish",
    }),
    resourcesToken = await token({
      azp: "tooling",
      scope: "files:read",
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
        ...(bearer ? { Authorization: "Bearer " + bearer } : {}),
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
  await provision(pool, "global", "models", {
    id: "main",
    label: "Test",
    baseUrl: remote + "/v1",
    protocol: "chat-completions",
    model: "test-model",
    apiKeyRef: "TEST_PROVIDER_KEY",
    temperature: 0,
    active: true,
  });
  await pool.query(
    "INSERT INTO backend_configurations (administration_id, resource, resource_id, body) VALUES ('global','procedures',$1,$2)",
    [procedure.id, procedure],
  );
  await pool.query(
    "INSERT INTO backend_mcp_servers(administration_id,id,body) VALUES('global','tooling',$1)",
    [JSON.stringify({ id: "tooling", name: "Tooling", url: remote + "/mcp", enabled: true, transport: "streamable-http", auth: { type: "bearer", secretRef: "backend-agent" }, policy: "techma" })],
  );
  for (const tool of catalog) {
    await pool.query(
      "INSERT INTO backend_mcp_tools(administration_id,server_id,name,definition,available,enabled,requires_mandate) VALUES('global','tooling',$1,$2,true,true,$3)",
      [tool.name, tool, Boolean(tool._meta?.["bj.techma/requiresMandate"])],
    );
  }
  const models = new HttpModels(
    { synthetic: { baseUrl: remote + "/v1/", protocol: "chat-completions" } },
    { TEST_PROVIDER_KEY: "test-key" },
  );
  const gateway = new McpGateway(
    new Set([remote + "/mcp"]),
    async () => secrets.agent,
  );
  const agent = new Agent(pool, conversations, models, gateway, consent);
  let c, userRef;
  const ownerRef = async (id) =>
    (await pool.query("SELECT user_ref FROM backend_conversations WHERE id=$1", [id])).rows[0].user_ref;
  await t.test(
    "C1 channel identity, ownership and message deduplication",
    async () => {
      const create = { locale: "fr" },
        idempotency = randomUUID();
      const first = await request("/v1/conversations", {
        method: "POST",
        body: create,
        idempotency,
      });
      assert.equal(first.status, 201);
      validate("Conversation", first.value);
      c = first.value;
      userRef = await ownerRef(c.id);
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
            body: { locale: "fr" },
            bearer: admin,
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
            body: { ...body, sentAt: "not-a-date" },
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
      assert.equal(mcpCalls[0].userRef, userRef);
      assert.equal(JSON.stringify(modelCalls).includes(userRef), false);
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
      assert.equal(
        (await request("/v1/conversations/" + c.id + "/events?cursor=" + "x".repeat(65))).status,
        400,
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
      const guest = await request(path + "/mandates", {
        method: "POST",
        body: { challengeId: identifier("chl"), accepted: true },
        bearer: await token({ token_use: "guest", sub: identifier("usr") }),
      });
      assert.ok(guest.status === 401 || guest.status === 403);
      const owner = { userRef: userRef, channel: "web", authenticated: true, expiresAt: Date.now() + 60000, roles: new Set(["citizen"]) };
      const issued = await consent.challenge(owner, c.id, { procedureId: procedure.id, scopes: ["requests:write"] }, randomUUID());
      validate("Challenge", issued);
      const challenge = { status: 201, value: issued };
      const proof = await jwtVerify(challenge.value.proofToken, key, {
        issuer,
        audience: "techma-mandate",
      });
      assert.equal(proof.payload.sub, userRef);
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
  await t.test("an expired unaccepted challenge is refused and left unconsumed", async () => {
    const owner = { userRef: userRef, channel: "web", authenticated: true, expiresAt: Date.now() + 60000, roles: new Set(["citizen"]) };
    const issued = await consent.challenge(owner, c.id, { procedureId: procedure.id, scopes: ["requests:write"] }, randomUUID());
    await pool.query(
      "UPDATE backend_challenges SET body = jsonb_set(body, '{expiresAt}', to_jsonb($2::text)) WHERE id=$1",
      [issued.id, new Date(Date.now() - 1000).toISOString()],
    );
    const expired = await request("/v1/conversations/" + c.id + "/mandates", {
      method: "POST",
      body: { challengeId: issued.id, accepted: true },
    });
    assert.equal(expired.status, 403);
    assert.equal(expired.value.code, "FORBIDDEN");
    assert.match(expired.value.detail, /expiré/i);
    const row = (await pool.query("SELECT consumed_at FROM backend_challenges WHERE id=$1", [issued.id])).rows[0];
    assert.equal(row.consumed_at, null);
  });
  await t.test("attach is single-use and mandates require a logged-in user", async () => {
    const issued = await request("/v1/guest-sessions", { method: "POST", bearer: undefined, headers: {} });
    assert.equal(issued.status, 201);
    const guestToken = issued.value.token;
    const guestConversation = await request("/v1/conversations", {
      method: "POST",
      body: { locale: "fr" },
      bearer: guestToken,
    });
    assert.equal(guestConversation.status, 201);
    const attached = await request("/v1/conversations/" + guestConversation.value.id + "/attach", {
      method: "POST",
      body: { guestToken },
    });
    assert.equal(attached.status, 200);
    validate("Conversation", attached.value);
    const replay = await request("/v1/conversations/" + guestConversation.value.id + "/attach", {
      method: "POST",
      body: { guestToken },
    });
    assert.equal(replay.status, 200);
    const otherGuest = await request("/v1/guest-sessions", { method: "POST" });
    const second = await request("/v1/conversations", {
      method: "POST",
      body: { locale: "fr" },
      bearer: otherGuest.value.token,
    });
    const reused = await request("/v1/conversations/" + second.value.id + "/attach", {
      method: "POST",
      body: { guestToken },
    });
    assert.equal(reused.status, 409);
    const guestMandate = await request("/v1/conversations/" + c.id + "/mandates", {
      method: "POST",
      body: { challengeId: identifier("chl"), accepted: true },
      bearer: otherGuest.value.token,
    });
    assert.ok(guestMandate.status === 401 || guestMandate.status === 403);
  });
  await t.test("concurrent attach of the same guest token succeeds once", async () => {
    const issued = await request("/v1/guest-sessions", { method: "POST", bearer: undefined, headers: {} });
    const guestToken = issued.value.token;
    const guestConversation = await request("/v1/conversations", {
      method: "POST",
      body: { locale: "fr" },
      bearer: guestToken,
    });
    assert.equal(guestConversation.status, 201);
    const guestRef = (await pool.query("SELECT user_ref FROM backend_conversations WHERE id=$1", [guestConversation.value.id])).rows[0].user_ref;
    const [first, second] = await Promise.all([
      request("/v1/conversations/" + guestConversation.value.id + "/attach", { method: "POST", body: { guestToken } }),
      request("/v1/conversations/" + guestConversation.value.id + "/attach", { method: "POST", body: { guestToken } }),
    ]);
    const statuses = [first.status, second.status];
    assert.ok(statuses.includes(200));
    assert.ok(statuses.every((status) => status === 200 || status === 403 || status === 409));
    const owners = await pool.query("SELECT user_ref FROM backend_conversations WHERE id=$1", [guestConversation.value.id]);
    assert.equal(owners.rows.length, 1);
    assert.equal(owners.rows[0].user_ref, userRef);
    const identity = await pool.query("SELECT consumed_at FROM backend_identities WHERE user_ref=$1", [guestRef]);
    assert.ok(identity.rows[0].consumed_at);
    const duplicates = await pool.query("SELECT count(*)::int AS n FROM backend_conversations WHERE id=$1", [guestConversation.value.id]);
    assert.equal(duplicates.rows[0].n, 1);
  });
  await t.test(
    "C4 authenticated ingestion, cross-owner rejection and request projection",
    async () => {
      const caseBody = {
        ...fixture.schemas.Case,
        id: identifier("cas"),
        requestId: identifier("req"),
        applicantRef: userRef,
      };
      const event = envelope(
        { kind: "case.updated", conversationId: c.id, case: caseBody },
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
      const sent = (await request("/v1/conversations/" + c.id + "/events")).value.items.find((item) => item.data.kind === "message.sent" && item.data.message.blocks.some((block) => block.type === "caseCard"));
      assert.equal(sent.data.message.blocks.find((block) => block.type === "caseCard").case.id, caseBody.id);
      const bad = envelope(
        {
          kind: "case.updated",
          conversationId: identifier("cnv"),
          case: { ...caseBody, id: identifier("cas") },
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
        404,
      );
    },
  );
  await t.test(
    "case.updated with an identical case is shown once, a changed case again",
    async () => {
      const caseBody = {
        ...fixture.schemas.Case,
        id: identifier("cas"),
        requestId: identifier("req"),
        applicantRef: userRef,
      };
      const publish = async (body) =>
        (
          await request("/internal/v1/events", {
            method: "POST",
            body: envelope(
              { kind: "case.updated", conversationId: c.id, case: body },
              tp,
              "tooling",
            ),
            bearer: eventsToken,
          })
        ).status;
      const cardsOf = async () =>
        (await request("/v1/conversations/" + c.id + "/events")).value.items
          .filter((item) => item.data.kind === "message.sent")
          .flatMap((item) => item.data.message.blocks)
          .filter((block) => block.type === "caseCard" && block.case.id === caseBody.id);
      assert.equal(await publish(caseBody), 202);
      assert.equal(await publish(caseBody), 202);
      assert.equal((await cardsOf()).length, 1);
      assert.equal(
        await publish({ ...caseBody, updatedAt: "2031-01-01T00:00:00.000Z" }),
        202,
      );
      assert.equal((await cardsOf()).length, 2);
    },
  );
  await t.test(
    "Private files usable immediately, ownership and expiry",
    async () => {
      const file = await request("/v1/files", {
        method: "POST",
        body: Buffer.from("%PDF-1.4 synthetic"),
        headers: { "X-File-Mime-Type": "application/pdf" },
      });
      assert.equal(file.status, 201);
      validate("File", file.value);
      assert.equal('scanStatus' in file.value, false);
      const metadata = "/internal/v1/files/" + file.value.id;
      assert.deepEqual((await request(metadata, { bearer: resourcesToken, headers: { "X-User-Ref": userRef } })).value.file, file.value);
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
        content: { type: "file", fileId: file.value.id, documentType: null },
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
      await skipResumes(pool);
      await agent.process(c.id);
      // Existing uploads and idempotency replays must survive the contract migration.
      await pool.query("UPDATE backend_files SET body=body || '{\"scanStatus\":\"rejected\"}'::jsonb WHERE id=$1", [file.value.id]);
      await pool.query("UPDATE backend_idempotency SET response=response || '{\"scanStatus\":\"pending\"}'::jsonb WHERE response->>'id'=$1", [file.value.id]);
      await pool.query("DELETE FROM backend_migrations WHERE name='006_remove_file_scan.sql'");
      await migrate(pool);
      assert.deepEqual((await files.metadata(file.value.id, userRef)).file, file.value);
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
            headers: { "X-User-Ref": userRef },
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
        body: { locale: "fr" },
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
        body: { locale: "fr" },
      });
      assert.equal(await ownerRef(first.value.id), await ownerRef(second.value.id));
      const forged = await token({ channel_subject: "+2290100000000" });
      const webCitizen = await request("/v1/conversations", {
        method: "POST",
        bearer: forged,
        body: { locale: "fr" },
      });
      assert.equal(webCitizen.status, 201);
      assert.equal(first.value.channel, "whatsapp");
      assert.equal(webCitizen.value.channel, "web");
      assert.notEqual(await ownerRef(webCitizen.value.id), await ownerRef(first.value.id));
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
    },
  );
  await t.test(
    "C3 administration and private resources follow the same contract",
    async () => {
      const operator = await token({
        realm_access: { roles: ["operator"] },
        scope: "operator admin:read admin:write",
        sub: "admin",
      });
      const listed = await request("/v1/operator/models", { bearer: operator });
      assert.equal(listed.status, 200);
      validate("ModelConfigPage", listed.value);
      assert.equal((await request("/v1/operator/status", { bearer: operator })).status, 200);
      assert.equal((await request("/v1/operator/models", { bearer: admin })).status, 403);
    },
  );
  await t.test(
    "Provider failures preserve pending work and Responses adapter preserves output items",
    async () => {
      failModel = true;
      const created = (
        await request("/v1/conversations", {
          method: "POST",
          body: { locale: "fr" },
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
          body: { locale: "fr" },
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
      const responses = new HttpModels(
        {
          synthetic: {
            baseUrl: remote + "/v1/",
            protocol: "responses",
            omitTemperature: true,
          },
        },
        { TEST_PROVIDER_KEY: "test-key" },
      );
      const config = {
        id: "test",
        label: "Test",
        baseUrl: remote + "/v1/",
        protocol: "responses",
        model: "test-model",
        apiKeyRef: "TEST_PROVIDER_KEY",
        temperature: 0,
        active: true,
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
      const challenge = await consent.challenge(
        { userRef: userRef, channel: "web", authenticated: true, expiresAt: Date.now() + 60000, roles: new Set(["citizen"]) },
        c.id,
        { procedureId: procedure.id, scopes: ["requests:write"] },
        randomUUID(),
      );
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
      await skipResumes(pool);
      await agent.process(c.id);
      assert.equal(remoteMandates.get(grant.id).status, "revoked");
      assert.equal(modelCalls.length, calls);
    },
  );
  await t.test(
    "Model tool results and replay history never expose server identity context",
    async () => {
      await pool.query(
        "UPDATE backend_mcp_tools SET enabled=true WHERE administration_id='global' AND name='case.status'",
      );
      const owned = {
        ...fixture.schemas.Request,
        id: identifier("req"),
        conversationId: c.id,
      };
      const port = {
        async discover() {
          return catalog;
        },
        async call(_url, _secret, name, _args, context) {
          assert.equal(name, "case.status");
          assert.equal(context.userRef, userRef);
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
          assert.equal(serialized.includes(userRef), false);
          assert.equal(serialized.includes(c.id), false);
          calls++;
          return calls % 2 === 1
            ? {
                text: "",
                calls: [
                  {
                    id: "status-call",
                    name: "case.status",
                    arguments: JSON.stringify({ requestId: owned.id }),
                  },
                ],
              }
            : {
                text: JSON.stringify({
                  blocks: [{ type: "text", text: "Statut du dossier.", sources: [] }],
                }),
                calls: [],
              };
        },
      };
      const reader = new Agent(pool, conversations, model, port, consent);
      await skipResumes(pool);
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
        assert.ok(block.type === "text" || block.type === "requestCard");
      }
      assert.ok(
        modelCalls.some((body) =>
          (body.tools ?? []).some((tool) => tool.function?.name === "procedures_get" || tool.function?.name === "case_status"),
        ),
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
