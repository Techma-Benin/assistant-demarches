import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Req,
  Inject,
  HttpCode,
} from "@nestjs/common";
import type { Request } from "express";
import type { Pool } from "pg";
import { verifyIdentity, scopes, type AuthOptions } from "./auth.js";
import { Identities, serviceClient, type User } from "./identity.js";
import { Conversations, type Event } from "./conversations.js";
import { Consent } from "./consent.js";
import type { ToolingPort } from "./tooling.js";
import { Files } from "./files.js";
import { Problem, type Schemas } from "./domain.js";
import { idempotencyKey } from "./transactions.js";

export const RUNTIME = Symbol("CONVERSATION_RUNTIME");
export type Runtime = {
  pool: Pool;
  tooling?: ToolingPort;
  auth: AuthOptions;
  identities: Identities;
  conversations: Conversations;
  consent?: Consent;
  files?: Files;
  publicUrl?: string;
};
const key = (req: Request) => idempotencyKey(req.get("Idempotency-Key"));
const trace = (req: Request) => req.get("traceparent")!;
async function user(runtime: Runtime, req: Request): Promise<User> {
  return runtime.identities.resolve(
    await verifyIdentity(req.get("authorization"), runtime.auth),
  );
}
async function service(
  runtime: Runtime,
  req: Request,
  client: string,
  scope: string,
) {
  const payload = await verifyIdentity(req.get("authorization"), runtime.auth);
  if (serviceClient(payload) !== client)
    throw new Problem(401, "UNAUTHORIZED", "Identité de service incompatible.");
  if (!scopes(payload).has(scope))
    throw new Problem(403, "FORBIDDEN", "Permission de service manquante.");
}
@Controller("v1")
export class ConversationController {
  constructor(@Inject(RUNTIME) private runtime: Runtime) {}
  @Post("conversations")
  create(@Req() req: Request, @Body() body: Schemas["ConversationInput"]) {
    return user(this.runtime, req).then((principal) =>
      this.runtime.conversations.create(principal, body, key(req)),
    );
  }
  @Post("conversations/:id/messages")
  @HttpCode(202)
  messages(
    @Param("id") id: string,
    @Req() req: Request,
    @Body() body: Schemas["MessageInput"],
  ) {
    return user(this.runtime, req).then((principal) =>
      this.runtime.conversations.accept(
        principal,
        id,
        body,
        key(req),
        trace(req),
      ),
    );
  }
  @Get("conversations/:id/events")
  async events(@Param("id") id: string, @Req() req: Request) {
    const principal = await user(this.runtime, req),
      cursor = req.query.cursor;
    if (
      cursor !== undefined &&
      (typeof cursor !== "string" || !cursor || cursor.length > 256)
    )
      throw new Problem(400, "INVALID_REQUEST", "Curseur invalide.");
    return this.runtime.conversations.page(
      principal.userRef,
      id,
      cursor as string | undefined,
    );
  }
  @Post("conversations/:id/socket-ticket")
  async ticket(@Param("id") id: string, @Req() req: Request) {
    const principal = await user(this.runtime, req);
    const socket = new URL(
      "/v1/stream",
      this.runtime.publicUrl ?? "http://127.0.0.1:" + req.socket.localPort,
    );
    socket.protocol = socket.protocol === "https:" ? "wss:" : "ws:";
    return this.runtime.conversations.ticket(
      principal,
      id,
      key(req),
      socket.href,
    );
  }
  @Post("conversations/:id/mandate-challenges")
  async challenge(
    @Param("id") id: string,
    @Req() req: Request,
    @Body() body: Schemas["ChallengeInput"],
  ) {
    const principal = await user(this.runtime, req);
    if (!this.runtime.consent)
      throw new Problem(
        503,
        "UPSTREAM_UNAVAILABLE",
        "Signature du consentement non configurée.",
      );
    return this.runtime.consent.challenge(principal, id, body, key(req));
  }
  @Post("conversations/:id/mandates")
  async grant(
    @Param("id") id: string,
    @Req() req: Request,
    @Body() body: Schemas["Consent"],
  ) {
    const principal = await user(this.runtime, req);
    if (!this.runtime.consent)
      throw new Problem(
        503,
        "UPSTREAM_UNAVAILABLE",
        "Contrôle mandat non configuré.",
      );
    return this.runtime.consent.grant(
      principal,
      id,
      body,
      key(req),
      trace(req),
    );
  }
  @Post("conversations/:id/mandates/:mandateId/revoke")
  @HttpCode(200)
  async revoke(
    @Param("id") id: string,
    @Param("mandateId") mandateId: string,
    @Req() req: Request,
  ) {
    const principal = await user(this.runtime, req);
    if (!this.runtime.consent)
      throw new Problem(
        503,
        "UPSTREAM_UNAVAILABLE",
        "Contrôle mandat non configuré.",
      );
    return this.runtime.consent.revoke(
      principal,
      id,
      mandateId,
      key(req),
      trace(req),
    );
  }
  @Get("requests/:id")
  async request(@Param("id") id: string, @Req() req: Request) {
    return this.runtime.conversations.request(
      (await user(this.runtime, req)).userRef,
      id,
    );
  }
  @Post("files")
  async upload(@Req() req: Request, @Body() body: Buffer) {
    const principal = await user(this.runtime, req);
    if (req.get("content-type") !== "application/octet-stream")
      throw new Problem(
        415,
        "UNSUPPORTED_MEDIA_TYPE",
        "application/octet-stream requis.",
      );
    if (!this.runtime.files)
      throw new Problem(503, "UPSTREAM_UNAVAILABLE", "Stockage non configuré.");
    return this.runtime.files.upload(
      principal.userRef,
      body,
      req.get("X-File-Mime-Type") ?? "",
      key(req),
    );
  }
}
@Controller("internal/v1")
export class InternalController {
  constructor(@Inject(RUNTIME) private runtime: Runtime) {}
  @Post("events")
  @HttpCode(202)
  async events(@Req() req: Request, @Body() event: Event) {
    await service(this.runtime, req, "tooling-events", "events:publish");
    return this.runtime.conversations.ingest(event, key(req));
  }
  @Get("files/:id")
  async file(@Param("id") id: string, @Req() req: Request) {
    await service(this.runtime, req, "tooling-resources", "resources:read");
    if (!this.runtime.files)
      throw new Problem(503, "UPSTREAM_UNAVAILABLE", "Stockage non configuré.");
    const owner = req.get("X-User-Ref");
    if (!owner) throw new Problem(400, "INVALID_REQUEST", "X-User-Ref requis.");
    return this.runtime.files.metadata(id, owner);
  }
  @Get("procedures")
  async procedures(@Req() req: Request) {
    await service(this.runtime, req, "tooling-resources", "resources:read");
    const query = req.query.query;
    if (typeof query !== "string" || !query || query.length > 1000)
      throw new Problem(400, "INVALID_REQUEST", "query requis.");
    // Literal substring search; query characters never become SQL wildcards.
    const { rows } = await this.runtime.pool.query(
      "SELECT body FROM backend_configurations WHERE resource='procedures' AND body->>'validationStatus'='validated' AND strpos(lower(body->>'title'),lower($1))>0 ORDER BY resource_id LIMIT 100",
      [query],
    );
    return { items: rows.map((row) => row.body), nextCursor: null };
  }
  @Get("procedures/:id")
  async procedure(@Param("id") id: string, @Req() req: Request) {
    await service(this.runtime, req, "tooling-resources", "resources:read");
    const rows = (
      await this.runtime.pool.query(
        "SELECT body FROM backend_configurations WHERE resource='procedures' AND resource_id=$1 AND body->>'validationStatus'='validated'",
        [id],
      )
    ).rows;
    if (rows.length !== 1)
      throw new Problem(404, "NOT_FOUND", "Fiche validée introuvable.");
    return rows[0].body;
  }
}
