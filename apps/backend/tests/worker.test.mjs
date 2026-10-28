import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import http from "node:http";
import { Queue } from "bullmq";
import { isolatedDatabase } from "./helpers.mjs";
import {
  database,
  migrate,
  provision,
} from "../dist/apps/backend/src/database.js";
import { Conversations } from "../dist/apps/backend/src/conversations.js";
import { identifier } from "../dist/apps/backend/src/domain.js";

const redisBinary = process.env.REDIS_TEST_BINARY ?? "/usr/bin/redis-server";
const redisAvailable =
  Boolean(process.env.REDIS_TEST_URL) || existsSync(redisBinary);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exit = once(child, "exit");
  child.kill("SIGTERM");
  const deadline = setTimeout(() => child.kill("SIGKILL"), 10000);
  await exit;
  clearTimeout(deadline);
}
test(
  "BullMQ worker consumes durable work through Redis and leaves one reply after restart",
  { skip: !redisAvailable },
  async (t) => {
    const pg = await isolatedDatabase(),
      pool = database(pg.connection);
    await migrate(pool);
    const root = mkdtempSync(join(tmpdir(), "techma-worker-test-"));
    t.after(async () => {
      await pool.end();
      await pg.close();
      rmSync(root, { recursive: true, force: true });
    });
    let redisUrl = process.env.REDIS_TEST_URL;
    if (!redisUrl) {
      const reservation = http.createServer();
      await new Promise((resolve) =>
        reservation.listen(0, "127.0.0.1", resolve),
      );
      const port = reservation.address().port;
      await new Promise((resolve) => reservation.close(resolve));
      const redis = spawn(
        redisBinary,
        [
          "--bind",
          "127.0.0.1",
          "--port",
          String(port),
          "--save",
          "",
          "--appendonly",
          "no",
          "--dir",
          root,
        ],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
      let logs = "";
      redis.stdout.on("data", (chunk) => {
        logs += chunk;
      });
      redis.stderr.on("data", () => {});
      t.after(() => stop(redis));
      for (
        let i = 0;
        i < 100 && !logs.includes("Ready to accept connections");
        i++
      ) {
        if (redis.exitCode !== null)
          throw new Error("Test Redis failed to start.");
        await pause(25);
      }
      assert.match(logs, /Ready to accept connections/);
      redisUrl = "redis://127.0.0.1:" + port;
    }
    let modelCalls = 0;
    const provider = http.createServer(async (req, res) => {
      for await (const chunk of req) {
      }
      modelCalls++;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  blocks: [
                    { type: "text", text: "No source invented", sources: [] },
                  ],
                }),
              },
            },
          ],
        }),
      );
    });
    await new Promise((resolve) => provider.listen(0, "127.0.0.1", resolve));
    t.after(
      () =>
        new Promise((resolve) => {
          provider.closeAllConnections();
          provider.close(resolve);
        }),
    );
    const origin = "http://127.0.0.1:" + provider.address().port;
    await provision(pool, "alpha", "models", {
      id: "model",
      provider: "synthetic",
      model: "test",
      temperature: 0,
      active: true,
      promptVersion: "agent-v1",
    });
    const conversations = new Conversations(pool),
      user = {
        userRef: identifier("usr"),
        administrationId: "alpha",
        channel: "portal",
        expiresAt: Date.now() + 600000,
      };
    const conversation = await conversations.create(
      user,
      { channel: "web", locale: "fr" },
      randomUUID(),
    );
    const message = {
      id: identifier("msg"),
      content: { type: "text", text: "Synthetic worker test" },
      sentAt: new Date().toISOString(),
    };
    await conversations.accept(
      user,
      conversation.id,
      message,
      randomUUID(),
      "00-" + "1".repeat(32) + "-" + "2".repeat(16) + "-01",
    );
    const prefix = "test-" + randomUUID();
    const childEnv = {
      ...process.env,
      DATABASE_URL: pg.connection,
      OIDC_ISSUER: origin,
      OIDC_JWKS_URL: origin + "/jwks",
      IDENTITY_HMAC_KEY: "synthetic-worker-identity-secret-32-chars",
      DEFAULT_ADMINISTRATION_ID: "alpha",
      REDIS_URL: redisUrl,
      QUEUE_PREFIX: prefix,
      STORAGE_DRIVER: "local",
      STORAGE_LOCAL_DIRECTORY: join(root, "files"),
      MODEL_PROVIDERS_JSON: JSON.stringify({
        synthetic: { baseUrl: origin + "/v1/", protocol: "chat-completions" },
      }),
      MCP_ALLOWED_URLS: "",
      MANDATE_SIGNING_KEY_FILE: "",
      WHATSAPP_CALLBACK_URL: "",
    };
    function start() {
      const child = spawn(
        process.execPath,
        ["dist/apps/backend/src/worker.js"],
        { env: childEnv, stdio: ["ignore", "pipe", "pipe"] },
      );
      child.stdout.on("data", () => {});
      child.stderr.on("data", () => {});
      return child;
    }
    let child = start();
    t.after(() => stop(child));
    for (let i = 0; i < 200; i++) {
      const page = await conversations.page(user.userRef, conversation.id);
      if (page.items.some((event) => event.data.kind === "message.sent")) break;
      if (child.exitCode !== null)
        throw new Error("Worker exited before processing its durable job.");
      await pause(50);
    }
    assert.equal(
      (await conversations.page(user.userRef, conversation.id)).items.filter(
        (event) => event.data.kind === "message.sent",
      ).length,
      1,
    );
    assert.equal(modelCalls, 1);
    await stop(child);
    child = start();
    await pause(1500);
    await stop(child);
    assert.equal(modelCalls, 1);
    assert.equal(
      (await conversations.page(user.userRef, conversation.id)).items.filter(
        (event) => event.data.kind === "message.sent",
      ).length,
      1,
    );
    const url = new URL(redisUrl);
    const connection = {
      host: url.hostname,
      port: Number(url.port || 6379),
      username: url.username ? decodeURIComponent(url.username) : undefined,
      password: url.password ? decodeURIComponent(url.password) : undefined,
      db: Number(url.pathname.slice(1) || 0),
      ...(url.protocol === "rediss:" ? { tls: {} } : {}),
    };
    const queue = new Queue("techma-conversations", { connection, prefix });
    await queue.obliterate({ force: true });
    await queue.close();
  },
);
