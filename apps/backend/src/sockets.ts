import type { Server } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import type { Conversations, Event } from "./conversations.js";

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
        !origins.includes(req.headers.origin) ||
        url.searchParams.getAll("ticket").length !== 1
      )
        throw new Error("Upgrade refused.");
      const { conversation, expiresAt } = await conversations.consumeTicket(
        url.searchParams.get("ticket")!,
      );
      let cursor = url.searchParams.get("cursor") ?? undefined;
      // Validate replay before committing the upgrade.
      await conversations.page(conversation.userRef, conversation.id, cursor);
      wss.handleUpgrade(req, socket, head, (ws) => {
        let stopped = false,
          timer: NodeJS.Timeout | undefined,
          alive = true,
          polling = true;
        const seen = new Set<string>();
        const queued: Event[] = [];
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
        const unsubscribe = conversations.onLive(conversation.id, (event) => {
          if (polling) queued.push(event);
          else deliver(event);
        });
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
        const poll = async () => {
          if (stopped || ws.readyState !== WebSocket.OPEN) return;
          if (Date.now() >= expiresAt) {
            ws.close(1008, "TOKEN_EXPIRED");
            return;
          }
          polling = true;
          try {
            const page = await conversations.page(
              conversation.userRef,
              conversation.id,
              cursor,
            );
            for (const event of page.items) deliver(event);
            while (queued.length) {
              for (const event of queued.splice(0)) deliver(event);
            }
            polling = false;
            if (!stopped)
              timer = setTimeout(poll, page.items.length === 100 ? 0 : 250);
          } catch {
            polling = false;
            ws.close(1008, "REPLAY_EXPIRED");
          }
        };
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
