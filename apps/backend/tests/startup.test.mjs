import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeyPairSync } from "node:crypto";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { createLocalJWKSet, jwtVerify } from "jose";
import { isolatedDatabase } from "./helpers.mjs";
import { database, migrate } from "../dist/apps/backend/src/database.js";
import { privateJwkFields } from "../dist/apps/backend/src/signing-jwks.js";

const mainJs = fileURLToPath(new URL("../dist/apps/backend/src/main.js", import.meta.url));
const PRIVATE_LOOP = /Cannot use a pool after calling end on the pool/;

function pem() {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return privateKey.export({ type: "pkcs8", format: "pem" });
}

function collect(child) {
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  return {
    output: () => stdout + stderr,
    stdout: () => stdout,
    stderr: () => stderr,
  };
}

async function waitFor(child, logs, pattern, ms = 20000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`process exited ${child.exitCode}: ${logs.output()}`);
    if (pattern.test(logs.output())) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timeout waiting for ${pattern}: ${logs.output()}`);
}

async function stop(child, signal = "SIGTERM") {
  if (child.exitCode !== null || child.signalCode !== null) return child.exitCode;
  const exit = once(child, "exit");
  child.kill(signal);
  const killer = setTimeout(() => child.kill("SIGKILL"), 8000);
  const [code] = await exit;
  clearTimeout(killer);
  return code;
}

function spawnMain(env) {
  return spawn(process.execPath, [mainJs], {
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function listen(port) {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

test("main starts, publishes a public JWKS that verifies a guest token, and exits cleanly on SIGTERM", async (t) => {
  const pg = await isolatedDatabase();
  const pool = database(pg.connection);
  t.after(async () => {
    await pool.end().catch(() => undefined);
    await pg.close();
  });
  await migrate(pool);
  const root = mkdtempSync(join(tmpdir(), "techma-startup-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const keyFile = join(root, "signing.pem");
  writeFileSync(keyFile, pem());
  const blocker = await listen(0);
  const port = blocker.address().port;
  await new Promise((resolve) => blocker.close(resolve));
  const publicUrl = `http://127.0.0.1:${port}`;
  const child = spawnMain({
    PORT: String(port),
    HOST: "127.0.0.1",
    DATABASE_URL: pg.connection,
    OIDC_ISSUER: "http://127.0.0.1:9/realms/techma",
    PUBLIC_URL: publicUrl,
    SIGNING_KEY_FILE: keyFile,
    TOOLING_URL: "http://127.0.0.1:9/",
    FILE_STORAGE_DIR: join(root, "files"),
  });
  const logs = collect(child);
  t.after(() => stop(child, "SIGKILL"));
  await waitFor(child, logs, /Backend listening/);
  const jwks = await (await fetch(`${publicUrl}/.well-known/jwks.json`)).json();
  assert.equal(jwks.keys.length, 1);
  for (const field of privateJwkFields) assert.equal(jwks.keys[0][field], undefined);
  const guest = await fetch(`${publicUrl}/v1/guest-sessions`, {
    method: "POST",
    headers: { traceparent: "00-" + "a".repeat(32) + "-" + "b".repeat(16) + "-01" },
  });
  assert.equal(guest.status, 201);
  const { token } = await guest.json();
  const { payload } = await jwtVerify(token, createLocalJWKSet(jwks), {
    issuer: publicUrl,
    audience: "techma-backend",
    algorithms: ["RS256"],
  });
  assert.equal(payload.token_use, "guest");
  const code = await stop(child, "SIGTERM");
  assert.equal(code, 0);
  assert.equal(PRIVATE_LOOP.test(logs.output()), false);
});

test("broken DATABASE_URL exits 1 once without draining the agent pool", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "techma-startup-bad-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const keyFile = join(root, "signing.pem");
  writeFileSync(keyFile, pem());
  const child = spawnMain({
    PORT: "4010",
    HOST: "127.0.0.1",
    DATABASE_URL: "postgres://techma:techma@127.0.0.1:1/backend",
    OIDC_ISSUER: "http://127.0.0.1:9/realms/techma",
    PUBLIC_URL: "http://127.0.0.1:4010",
    SIGNING_KEY_FILE: keyFile,
    TOOLING_URL: "http://127.0.0.1:9/",
    FILE_STORAGE_DIR: join(root, "files"),
  });
  const logs = collect(child);
  const [code] = await Promise.race([
    once(child, "exit"),
    new Promise((_, reject) => setTimeout(() => reject(new Error("hung: " + logs.output())), 15000)),
  ]);
  assert.equal(code, 1);
  const lines = logs
    .stderr()
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !/DeprecationWarning|trace-deprecation/.test(line));
  assert.equal(lines.length, 1, logs.output());
  assert.equal(PRIVATE_LOOP.test(logs.output()), false);
  assert.doesNotMatch(logs.output(), /Backend listening/);
});

test("listen failure after the agent started aborts the watch before pool.end", async (t) => {
  const pg = await isolatedDatabase();
  const pool = database(pg.connection);
  t.after(async () => {
    await pool.end().catch(() => undefined);
    await pg.close();
  });
  await migrate(pool);
  const root = mkdtempSync(join(tmpdir(), "techma-startup-busy-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const keyFile = join(root, "signing.pem");
  writeFileSync(keyFile, pem());
  const blocker = await listen(0);
  t.after(() => new Promise((resolve) => blocker.close(resolve)));
  const port = blocker.address().port;
  const child = spawnMain({
    PORT: String(port),
    HOST: "127.0.0.1",
    DATABASE_URL: pg.connection,
    OIDC_ISSUER: "http://127.0.0.1:9/realms/techma",
    PUBLIC_URL: `http://127.0.0.1:${port}`,
    SIGNING_KEY_FILE: keyFile,
    TOOLING_URL: "http://127.0.0.1:9/",
    FILE_STORAGE_DIR: join(root, "files"),
  });
  const logs = collect(child);
  const [code] = await Promise.race([
    once(child, "exit"),
    new Promise((_, reject) => setTimeout(() => reject(new Error("hung: " + logs.output())), 15000)),
  ]);
  assert.equal(code, 1);
  assert.match(logs.output(), /EADDRINUSE|listen/);
  assert.equal(PRIVATE_LOOP.test(logs.output()), false);
  const errors = logs
    .stderr()
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !/DeprecationWarning|trace-deprecation/.test(line));
  assert.equal(errors.length, 1, logs.output());
});
