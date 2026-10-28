import { logFailure } from "./diagnostics.js";
import { Queue, Worker, type ConnectionOptions } from "bullmq";
import { database } from "./database.js";
import { remoteAuth } from "./auth.js";
import { loadRuntime, required } from "./runtime.js";
import { Delivery } from "./delivery.js";

const pool = database(required("DATABASE_URL"));
const auth = remoteAuth(required("OIDC_ISSUER"), required("OIDC_JWKS_URL"));
const allowed = new Set(
  (process.env.MCP_ALLOWED_URLS ?? "")
    .split(",")
    .filter(Boolean)
    .map((value) => new URL(value.trim()).href),
);
const { runtime, agent, tokens } = await loadRuntime(pool, auth, allowed);
const url = new URL(required("REDIS_URL"));
if (!["redis:", "rediss:"].includes(url.protocol))
  throw new Error("Invalid REDIS_URL.");
const connection: ConnectionOptions = {
  host: url.hostname,
  port: Number(url.port || 6379),
  username: url.username ? decodeURIComponent(url.username) : undefined,
  password: url.password ? decodeURIComponent(url.password) : undefined,
  db: Number(url.pathname.slice(1) || 0),
  ...(url.protocol === "rediss:" ? { tls: {} } : {}),
};
const prefix = process.env.QUEUE_PREFIX ?? "techma";
const queue = new Queue("techma-conversations", { connection, prefix });
const worker = new Worker(
  "techma-conversations",
  async (job) => {
    await agent.process(job.data.conversationId);
  },
  { connection, prefix, concurrency: 4 },
);
worker.on("error", error => logFailure("worker.queue_error", error));
worker.on("failed", (job, error) => logFailure("worker.job_failed", error, {
  jobId: job?.id, conversationId: job?.data?.conversationId, attemptsMade: job?.attemptsMade,
}));
queue.on("error", error => logFailure("worker.dispatcher_error", error));
const delivery = process.env.WHATSAPP_CALLBACK_URL
  ? new Delivery(pool, process.env.WHATSAPP_CALLBACK_URL, () =>
      tokens.get("backend-delivery", "messages:deliver", "whatsapp-adapter"),
    )
  : undefined;
let stopped = false,
  timer: NodeJS.Timeout,
  maintenance: Promise<void>;
async function dispatch() {
  if (stopped) return;
  try {
    // PostgreSQL is the durable source. A lost Redis queue can be rebuilt from this scan.
    const rows = (
      await pool.query(
        "SELECT conversation_id,min(seq) AS first_seq FROM backend_messages WHERE processed_at IS NULL GROUP BY conversation_id ORDER BY first_seq LIMIT 100",
      )
    ).rows;
    for (const row of rows) {
      const id = "conversation-" + row.conversation_id;
      const existing = await queue.getJob(id);
      if (existing) {
        const state = await existing.getState();
        if (state === "failed" || state === "completed")
          await existing.remove();
        else continue;
      }
      await queue.add(
        "conversation",
        { conversationId: row.conversation_id },
        {
          jobId: id,
          attempts: 5,
          backoff: { type: "exponential", delay: 1000 },
          removeOnComplete: true,
        },
      );
    }
    for (const operation of [
      () => runtime.files?.scanPending(),
      () => runtime.files?.purgeExpired(),
      () => delivery?.next(),
    ]) {
      try {
        await operation();
      } catch (error) {
        logFailure("worker.maintenance_operation_failed", error);
      }
    }
    await pool.query(
      "DELETE FROM backend_socket_tickets WHERE expires_at<=now()",
    );
    await pool.query("DELETE FROM backend_idempotency WHERE expires_at<now()");
    await pool.query(
      "DELETE FROM backend_messages WHERE processed_at<now()-interval '48 hours'",
    );
    await pool.query(
      "DELETE FROM backend_tool_results WHERE created_at<now()-interval '48 hours' AND NOT EXISTS(SELECT 1 FROM backend_messages m WHERE m.conversation_id=backend_tool_results.conversation_id AND m.processed_at IS NULL)",
    );
    await pool.query(
      "DELETE FROM backend_conversation_events WHERE expires_at<now() AND (callback_delivered_at IS NOT NULL OR callback_failed OR NOT EXISTS(SELECT 1 FROM backend_conversations c WHERE c.id=backend_conversation_events.conversation_id AND c.body->>'channel'='whatsapp'))",
    );
  } catch (error) {
    logFailure("worker.maintenance_failed", error);
  } finally {
    if (!stopped) timer = setTimeout(schedule, 1000);
  }
}
function schedule() {
  maintenance = dispatch();
}
schedule();
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, async () => {
    stopped = true;
    clearTimeout(timer);
    await maintenance;
    await worker.close();
    await queue.close();
    await pool.end();
  });
