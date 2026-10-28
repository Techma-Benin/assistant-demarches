import http from "node:http";
import net from "node:net";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isolatedDatabase } from "../apps/backend/tests/helpers.mjs";
import { database, migrate, provision } from "../apps/backend/dist/apps/backend/src/database.js";
import { createBackend } from "../apps/backend/dist/apps/backend/src/app.js";
import { remoteAuth } from "../apps/backend/dist/apps/backend/src/auth.js";
import { loadRuntime } from "../apps/backend/dist/apps/backend/src/runtime.js";
import { catalog } from "../apps/backend/dist/apps/backend/src/tooling.js";
import { createApp as createTooling } from "../apps/tooling/dist/src/app.js";
import { loadConfig } from "../apps/tooling/dist/src/config.js";
import { Database as ToolingDatabase } from "../apps/tooling/dist/src/database/database.js";

const backendRequire = createRequire(new URL("../apps/backend/package.json", import.meta.url));
const { generateKeyPair, exportJWK, exportPKCS8, SignJWT } = await import(backendRequire.resolve("jose"));
const { Queue } = backendRequire("bullmq");
const repository = fileURLToPath(new URL("../", import.meta.url));
export const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function until(check, label, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await pause(100);
  }
  throw new Error(`Délai dépassé : ${label}`);
}

async function listen(server, port = 0) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return `http://127.0.0.1:${server.address().port}`;
}

async function closeServer(server) {
  server.closeAllConnections?.();
  await new Promise(resolve => server.close(resolve));
}

async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise(resolve => {
    const timer = setTimeout(() => child.kill("SIGKILL"), 10000);
    child.once("exit", () => { clearTimeout(timer); resolve(); });
    child.kill("SIGTERM");
  });
}

async function startRedis(cleanup) {
  const configured = process.env.INTEGRATION_REDIS_URL ?? process.env.REDIS_TEST_URL;
  if (configured) {
    const url = new URL(configured);
    if (!["redis:", "rediss:"].includes(url.protocol) || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
      throw new Error("Utiliser un Redis de test sur localhost.");
    return configured;
  }
  const binary = process.env.REDIS_TEST_BINARY ?? "/usr/bin/redis-server";
  if (!existsSync(binary)) throw new Error("Redis requis : définir INTEGRATION_REDIS_URL ou REDIS_TEST_BINARY (voir integration/README.md).");
  const reservation = net.createServer();
  const url = await listen(reservation);
  await closeServer(reservation);
  const port = new URL(url).port;
  const child = spawn(binary, ["--bind", "127.0.0.1", "--port", port, "--save", "", "--appendonly", "no"], { detached: true, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  cleanup.push(() => stop(child));
  let logs = "";
  child.stdout.on("data", chunk => { logs = (logs + chunk).slice(-8000); });
  child.stderr.on("data", chunk => { logs = (logs + chunk).slice(-8000); });
  child.on("error", error => { logs += error.message; });
  await until(() => {
    if (child.exitCode !== null) throw new Error(`Redis : ${logs}`);
    return logs.includes("Ready to accept connections");
  }, "démarrage Redis");
  return `redis://127.0.0.1:${port}`;
}

/** A deliberately scripted model: only the commands below produce tool calls. */
function modelReply(body, procedure) {
  const messages = body.messages ?? [];
  const lastUser = messages.findLastIndex(message => message.role === "user");
  const text = messages[lastUser]?.content ?? "";
  const results = messages.slice(lastUser + 1).filter(message => message.role === "tool").map(message => {
    try { const parsed = JSON.parse(message.content); return parsed.result ?? parsed; } catch { return {}; }
  });
  const call = (name, args) => ({ content: null, tool_calls: [{ id: randomUUID(), type: "function", function: { name: name.replaceAll(".", "_"), arguments: JSON.stringify(args) } }] });
  if (!results.length) {
    if (text === "rechercher") return call("procedures.search", { query: "fictive", locale: "fr" });
    if (text === "creer") return call("request.create", { procedureId: procedure.id });
    const update = /^completer (req_[0-9A-HJKMNP-TV-Z]{26})$/.exec(text);
    if (update) return call("request.update", { requestId: update[1], fields: { displayName: "Usager fictif" } });
    const attach = /^joindre (req_[0-9A-HJKMNP-TV-Z]{26}) (fil_[0-9A-HJKMNP-TV-Z]{26})$/.exec(text);
    if (attach) return call("documents.attach", { requestId: attach[1], fileId: attach[2], documentType: "demo-document" });
    const submit = /^soumettre (req_[0-9A-HJKMNP-TV-Z]{26})$/.exec(text);
    if (submit) return call("request.submit", { requestId: submit[1] });
    return call("procedures.get", { procedureId: procedure.id });
  }
  const request = results.find(result => result.id?.startsWith("req_"));
  if (request) return { content: JSON.stringify({ blocks: [{ type: "statusCard", request }] }) };
  const found = results.flatMap(result => result.items ?? (result.source ? [result] : []));
  if (found.length) return { content: JSON.stringify({ blocks: [{ type: "text", text: "Démarche fictive disponible pour le test d’intégration.", sources: [found[0].source] }] }) };
  return { content: JSON.stringify({ blocks: [{ type: "text", text: "Action refusée. Consulter les événements de la conversation.", sources: [] }] }) };
}

export async function startStack({ backendPort = 0, toolingPort = 0 } = {}) {
  const cleanup = [];
  const previousEnvironment = { ...process.env };
  const directory = mkdtempSync(join(tmpdir(), "techma-integration-"));
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  let closing;
  const close = () => closing ??= (async () => {
    const errors = [];
    for (const operation of cleanup.splice(0).reverse()) {
      try { await operation(); } catch (error) { errors.push(error); }
    }
    for (const name of Object.keys(process.env)) if (!(name in previousEnvironment)) delete process.env[name];
    Object.assign(process.env, previousEnvironment);
    if (errors.length) throw new AggregateError(errors, "Nettoyage de la pile d’intégration");
  })();
  try {
    const redisUrl = await startRedis(cleanup);
    if (process.env.INTEGRATION_DATABASE_URL) process.env.BACKEND_TEST_DATABASE_URL = process.env.INTEGRATION_DATABASE_URL;
    const pg = await isolatedDatabase();
    cleanup.push(() => pg.close());
    const pool = database(pg.connection);
    cleanup.push(() => pool.end());
    await migrate(pool);
    const toolingDbName = `integration_tooling_${randomBytes(8).toString("hex")}_test`;
    await pool.query(`CREATE DATABASE ${toolingDbName}`);
    cleanup.push(() => pool.query(`DROP DATABASE IF EXISTS ${toolingDbName} WITH (FORCE)`));
    const toolingConnection = new URL(pg.connection);
    toolingConnection.pathname = "/" + toolingDbName;
    toolingConnection.searchParams.delete("options");

    const identityKeys = await generateKeyPair("RS256");
    const proofKeys = await generateKeyPair("RS256", { extractable: true });
    const jwks = { keys: [{ ...await exportJWK(identityKeys.publicKey), kid: "integration-identity", alg: "RS256", use: "sig" }] };
    const proofJwks = { keys: [{ ...await exportJWK(proofKeys.publicKey), kid: "integration-proof", alg: "RS256", use: "sig" }] };
    const fixture = JSON.parse(readFileSync(new URL("../mocks/fixtures.json", import.meta.url)));
    const procedure = { ...fixture.schemas.Procedure, validationStatus: "validated" };
    const clients = {
      "backend-agent": { scope: "tools:call", audience: "techma-tooling" },
      "backend-mandates": { scope: "mandates:grant", audience: "techma-tooling" },
      "tooling-resources": { scope: "resources:read", audience: "techma-backend" },
      "tooling-events": { scope: "events:publish", audience: "techma-backend" },
    };
    const secrets = Object.fromEntries(Object.keys(clients).map(name => [name, randomBytes(24).toString("hex")]));
    const tokenRequests = [];
    let issuer;
    const sign = (claims, subject, audience = "techma-backend") => new SignJWT(claims)
      .setProtectedHeader({ alg: "RS256", kid: "integration-identity" }).setIssuer(issuer)
      .setSubject(subject).setAudience(audience).setIssuedAt().setExpirationTime("8h").sign(identityKeys.privateKey);
    const upstream = http.createServer(async (req, res) => {
      const json = (status, value) => { res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify(value)); };
      try {
        if (req.method === "GET" && req.url === "/jwks") return json(200, jwks);
        if (req.method === "GET" && req.url === "/proof-jwks") return json(200, proofJwks);
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const input = Buffer.concat(chunks).toString();
        if (req.method === "POST" && req.url === "/token") {
          const form = new URLSearchParams(input);
          const name = form.get("client_id"), client = clients[name];
          if (!client || form.get("grant_type") !== "client_credentials" || form.get("client_secret") !== secrets[name] || form.get("scope") !== client.scope || (form.has("audience") && form.get("audience") !== client.audience)) return json(401, { error: "invalid_client" });
          tokenRequests.push(name);
          return json(200, { access_token: await sign({ azp: name, scope: client.scope }, name, client.audience), expires_in: 28800, token_type: "Bearer" });
        }
        if (req.method === "POST" && req.url === "/v1/chat/completions") return json(200, { choices: [{ message: modelReply(JSON.parse(input), procedure) }] });
        return json(404, { error: "not_found" });
      } catch { return json(500, { error: "integration_fixture_failed" }); }
    });
    issuer = await listen(upstream);
    cleanup.push(() => closeServer(upstream));
    const proofFile = join(directory, "proof.pem");
    writeFileSync(proofFile, await exportPKCS8(proofKeys.privateKey), { mode: 0o600 });

    // This fixture accepts only our exact synthetic file, never arbitrary documents.
    const syntheticFile = Buffer.from("TECHMA SYNTHETIC INTEGRATION FILE\n");
    const scanner = net.createServer(socket => {
      let buffered = Buffer.alloc(0), started = false, parts = [], total = 0;
      socket.setTimeout(5000, () => socket.destroy());
      socket.on("error", () => {});
      socket.on("data", chunk => {
        buffered = Buffer.concat([buffered, chunk]);
        if (!started) {
          if (buffered.length < 10) return;
          if (buffered.subarray(0, 10).toString() !== "zINSTREAM\0") return socket.destroy();
          buffered = buffered.subarray(10); started = true;
        }
        while (buffered.length >= 4) {
          const size = buffered.readUInt32BE();
          if (total + size > 10485760) return socket.destroy();
          if (buffered.length < size + 4) return;
          const part = buffered.subarray(4, size + 4);
          buffered = buffered.subarray(size + 4);
          if (!size) return socket.end(Buffer.concat(parts).equals(syntheticFile) ? "stream: OK\0" : "stream: SyntheticFixtureOnly FOUND\0");
          parts.push(part); total += size;
        }
      });
    });
    const scannerUrl = new URL(await listen(scanner));
    cleanup.push(() => closeServer(scanner));
    const prefix = "integration-" + randomUUID();
    const redis = new URL(redisUrl);
    const queue = new Queue("techma-conversations", { prefix, connection: {
      host: redis.hostname, port: Number(redis.port || 6379), db: Number(redis.pathname.slice(1) || 0),
      connectTimeout: 5000, maxRetriesPerRequest: 1, retryStrategy: attempt => attempt <= 3 ? 100 : null,
      username: redis.username ? decodeURIComponent(redis.username) : undefined,
      password: redis.password ? decodeURIComponent(redis.password) : undefined,
      ...(redis.protocol === "rediss:" ? { tls: {} } : {}),
    } });
    cleanup.push(async () => { try { await queue.obliterate({ force: true }); } finally { await queue.close(); } });
    await queue.waitUntilReady();

    const env = {
      ...process.env, NODE_ENV: "development", HOST: "127.0.0.1", DATABASE_URL: pg.connection,
      OIDC_ISSUER: issuer, OIDC_JWKS_URL: issuer + "/jwks", SERVICE_TOKEN_URL: issuer + "/token",
      TOOLING_AGENT_CLIENT_SECRET: secrets["backend-agent"], TOOLING_CONTROL_CLIENT_SECRET: secrets["backend-mandates"],
      TOOLING_AGENT_TOKEN: "", TOOLING_CONTROL_TOKEN: "", BACKEND_DEV_AUTH_FILE: "", BACKEND_DEV_AUTH: "false",
      IDENTITY_HMAC_KEY: randomBytes(32).toString("hex"), DEFAULT_ADMINISTRATION_ID: procedure.administrationId,
      MANDATE_SIGNING_KEY_FILE: proofFile, MANDATE_SIGNING_KEY_ID: "integration-proof", MANDATE_ISSUER: issuer,
      REDIS_URL: redisUrl, QUEUE_PREFIX: prefix, WHATSAPP_CALLBACK_URL: "", MCP_SECRET_REFERENCES: "{}",
      STORAGE_DRIVER: "local", STORAGE_LOCAL_DIRECTORY: join(directory, "files"), CLAMAV_HOST: "127.0.0.1", CLAMAV_PORT: scannerUrl.port,
      MODEL_PROVIDERS_JSON: JSON.stringify({ integration: { baseUrl: issuer + "/v1/", protocol: "chat-completions" } }),
    };
    // Bind the Backend first; no model job can run until the worker starts below.
    Object.assign(process.env, env, { MCP_ALLOWED_URLS: "", TOOLING_CONTROL_URL: "http://127.0.0.1:4030" });
    const allowed = new Set();
    const auth = remoteAuth(issuer, issuer + "/jwks");
    const tokens = {
      user: await sign({ administrationId: procedure.administrationId }, "integration-user"),
      admin: await sign({ administrationId: procedure.administrationId, scope: "admin:read admin:write" }, "integration-admin"),
      other: await sign({ administrationId: procedure.administrationId }, "integration-other-user"),
    };
    // Runtime is wired after Tooling's dynamic port is known.
    const backendReservation = net.createServer();
    const backendUrl = await listen(backendReservation, backendPort);
    await closeServer(backendReservation);
    const tooling = await createTooling(loadConfig({
      NODE_ENV: "development", AUTH_MODE: "jwt", TOOLING_HOST: "127.0.0.1", TOOLING_PORT: String(toolingPort),
      DATABASE_URL: toolingConnection.href, BACKEND_URL: backendUrl,
      JWT_ISSUER: issuer, JWKS_URL: issuer + "/jwks", OIDC_TOKEN_URL: issuer + "/token",
      PROOF_JWKS_URL: issuer + "/proof-jwks", PROOF_ISSUER: issuer,
      TOOLING_RESOURCES_CLIENT_ID: "tooling-resources", TOOLING_RESOURCES_CLIENT_SECRET: secrets["tooling-resources"],
      TOOLING_EVENTS_CLIENT_ID: "tooling-events", TOOLING_EVENTS_CLIENT_SECRET: secrets["tooling-events"],
      EVENTS_PUBLISHER: "on", EVENTS_INTERVAL_MS: "100", PROCEDURES_ALLOW_DRAFTS: "false",
    }), { shutdownHooks: false });
    cleanup.push(() => tooling.close());
    await tooling.listen(toolingPort, "127.0.0.1");
    const toolingUrl = await tooling.getUrl();
    env.MCP_ALLOWED_URLS = toolingUrl + "/mcp";
    env.TOOLING_CONTROL_URL = toolingUrl;
    env.PUBLIC_BACKEND_URL = backendUrl;
    allowed.add(env.MCP_ALLOWED_URLS);
    Object.assign(process.env, env);
    const { runtime } = await loadRuntime(pool, auth, allowed);
    const backend = await createBackend({ pool, auth, allowedMcpUrls: allowed, runtime, developmentTokens: { user: tokens.user, admin: tokens.admin } });
    cleanup.push(() => backend.close());
    await backend.listen(Number(new URL(backendUrl).port), "127.0.0.1");
    await provision(pool, procedure.administrationId, "procedures", procedure);
    await provision(pool, procedure.administrationId, "models", { id: "integration-model", provider: "integration", model: "scripted-integration", promptVersion: "agent-v1", temperature: 0, active: true });
    for (const tool of catalog) await provision(pool, procedure.administrationId, "tools", { name: tool.name, enabled: true, serverUrl: env.MCP_ALLOWED_URLS, secretRef: "backend-agent" });

    let worker, workerLogs = "";
    const startWorker = () => {
      worker = spawn(process.execPath, ["apps/backend/dist/apps/backend/src/worker.js"], { cwd: repository, env, detached: true, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      for (const stream of [worker.stdout, worker.stderr]) stream.on("data", chunk => { workerLogs = (workerLogs + chunk).slice(-12000); });
      worker.on("error", error => { workerLogs += error.message; });
    };
    startWorker();
    cleanup.push(() => stop(worker));
    return {
      backendUrl, toolingUrl, pool, toolingDb: tooling.get(ToolingDatabase), procedure, tokens, syntheticFile, tokenRequests,
      directory, close, get workerLogs() { return workerLogs; },
      async restartWorker() { await stop(worker); startWorker(); },
      assertWorker() { if (worker.exitCode !== null || worker.signalCode !== null) throw new Error(`Worker arrêté : ${workerLogs}`); },
    };
  } catch (error) {
    await close().catch(cleanupError => { console.error(cleanupError); });
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const stack = await startStack({ backendPort: Number(process.env.INTEGRATION_BACKEND_PORT ?? 4110), toolingPort: Number(process.env.INTEGRATION_TOOLING_PORT ?? 4130) });
  const sample = join(stack.directory, "synthetic.pdf");
  writeFileSync(sample, stack.syntheticFile);
  console.log(`Pile locale prête — données fictives, OIDC/modèle/antivirus de test uniquement.\nSwagger : ${stack.backendUrl}/docs\nTooling réel : ${stack.toolingUrl}/mcp\nPièce synthétique autorisée : ${sample}\nCommandes modèle : rechercher, creer, completer <req_id>, joindre <req_id> <fil_id>, soumettre <req_id>, STOP\nCtrl+C supprime les bases, fichiers et clés de cette session.`);
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => stack.close().then(() => process.exit(0), error => { console.error(error); process.exit(1); }));
}
