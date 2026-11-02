import type { Server } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import type { Conversations, Event } from "./conversations.js";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
/**
 * Exact match of `CORS_ORIGINS`, plus the other loopback spellings of an allowed loopback origin on the same
 * scheme and port: a browser on http://localhost:3000 must not be refused when only http://127.0.0.1:3000 is listed.
 */
export function socketOriginAllowed(origin: string | undefined, allowed: readonly string[]): boolean {
  if (!origin) return false;
  if (allowed.includes(origin)) return true;
  let candidate: URL;
  try {
    candidate = new URL(origin);
  } catch {
    return false;
  }
  if (!LOOPBACK_HOSTS.has(candidate.hostname)) return false;
  return allowed.some((value) => {
    try {
      const known = new URL(value);
      return LOOPBACK_HOSTS.has(known.hostname) && known.protocol === candidate.protocol && known.port === candidate.port;
    } catch {
      return false;
    }
  });
}

export function attachSockets(
  server: Server,
  conversations: Conversations,
  origins: string[],
) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 });
  const upgrade = async (req: any, socket: any, head: Buffer) => {
    try {
      const url = new URL(req.url, "http://localhost");
      if (
        url.pathname !== "/v1/stream" ||
        !socketOriginAllowed(req.headers.origin, origins) ||
        url.searchParams.getAll("ticket").length !== 1
      )
        throw new Error("Upgrade refused.");
      const { conversation, expiresAt } = await conversations.consumeTicket(
        url.searchParams.get("ticket")!,
      );
      let cursor = url.searchParams.get("cursor") ?? undefined;
      // Validate replay before committing the upgrade. The ticket is already spent, so an unknown cursor is
      // answered the way the Interface expects: upgrade, then close 1008 REPLAY_EXPIRED (it restarts without cursor).
      let replayExpired = false;
      try {
        await conversations.page(conversation.userRef, conversation.id, cursor);
      } catch (error) {
        if ((error as { status?: number }).status !== 410) throw error;
        replayExpired = true;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        if (replayExpired) {
          ws.close(1008, "REPLAY_EXPIRED");
          return;
        }
        let stopped = false,
          timer: NodeJS.Timeout | undefined,
          alive = true,
          running = false,
          again = false;
        const seen = new Set<string>();
        const deliver = (event: Event) => {
          if (stopped || ws.readyState !== WebSocket.OPEN) return;
          const kind = event.data.kind;
          if (kind !== "message.received" && kind !== "message.delta" && kind !== "message.sent") return;
          if (seen.has(event.id)) return;
          if (ws.bufferedAmount > 1048576) {
            ws.close(1013, "SLOW_CONSUMER");
            return;
          }
          seen.add(event.id);
          ws.send(JSON.stringify(event));
          cursor = event.id;
        };
        // Frames always come from the stored events, in order, from the cursor. A live notification only wakes
        // the reader: pushing the notified event itself could move the cursor past an older event not read yet
        // (a voice transcript committed just before the first delta, a message sent during a reply).
        const poll = async () => {
          if (stopped || ws.readyState !== WebSocket.OPEN) return;
          if (running) {
            again = true;
            return;
          }
          running = true;
          clearTimeout(timer);
          let full = false;
          try {
            do {
              again = false;
              if (Date.now() >= expiresAt) {
                ws.close(1008, "TOKEN_EXPIRED");
                return;
              }
              const page = await conversations.page(
                conversation.userRef,
                conversation.id,
                cursor,
              );
              for (const event of page.items) deliver(event);
              full = page.items.length === 100;
            } while ((again || full) && !stopped && ws.readyState === WebSocket.OPEN);
          } catch {
            ws.close(1008, "REPLAY_EXPIRED");
            return;
          } finally {
            running = false;
          }
          if (!stopped) timer = setTimeout(poll, 250);
        };
        const unsubscribe = conversations.onLive(conversation.id, () => void poll());
        const stop = () => {
          stopped = true;
          unsubscribe();
          clearTimeout(timer);
          clearInterval(heartbeat);
        };
        const heartbeat = setInterval(() => {
          if (!alive) {
            ws.terminate();
            return;
          }
          alive = false;
          ws.ping();
        }, 30000);
        ws.on("pong", () => {
          alive = true;
        });
        ws.on("close", stop);
        ws.on("error", stop);
        void poll();
      });
    } catch {
      socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
    }
  };
  server.on("upgrade", upgrade);
  return () => {
    server.off("upgrade", upgrade);
    for (const socket of wss.clients) socket.terminate();
    wss.close();
  };
}
