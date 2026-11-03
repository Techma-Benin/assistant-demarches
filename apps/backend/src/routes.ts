import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Req,
  Res,
  Inject,
  HttpCode,
} from "@nestjs/common";
import type { Request, Response } from "express";
import type { Pool } from "pg";
import { verifyIdentity, scopes, type AuthOptions } from "./auth.js";
import { Identities, serviceClient, type User } from "./identity.js";
import { Conversations, type Event } from "./conversations.js";
import { Consent } from "./consent.js";
import type { ToolingPort } from "./tooling.js";
import { Files } from "./files.js";
import { Problem, validate, type Schemas } from "./domain.js";
import { idempotencyKey } from "./transactions.js";
import type { CryptoKey } from "jose";
import type { ServiceTokens } from "./runtime.js";
import { XroadClient } from "./xroad.js";
import { documentDisposition } from "./download.js";

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
  signing?: { key: CryptoKey; kid: string; issuer: string };
  xroadUrl?: string;
  serviceTokens?: ServiceTokens;
};
const key = (req: Request) => idempotencyKey(req.get("Idempotency-Key"));
const trace = (req: Request) => req.get("traceparent")!;
function catalogue(runtime: Runtime, req?: Request) {
  if (!runtime.xroadUrl || !runtime.serviceTokens)
    throw new Problem(503, "UPSTREAM_UNAVAILABLE", "X-Road non configuré.");
  return new XroadClient(
    runtime.xroadUrl,
    () => runtime.serviceTokens!.get("xroad:apply"),
    req?.get("traceparent") ?? undefined,
  );
}
function xroadQuery(req: Request, names: string[]) {
  const params = new URLSearchParams();
  for (const name of names) {
    const value = req.query[name];
    if (value === undefined || value === "") continue;
    if (Array.isArray(value) || typeof value === "object")
      throw new Problem(400, "INVALID_REQUEST", "Paramètre invalide.");
    params.set(name, String(value));
  }
  const encoded = params.toString();
  return encoded ? "?" + encoded : "";
}
function loggedIn(principal: User) {
  if (!principal.authenticated)
    throw new Problem(401, "LOGIN_REQUIRED", "Connexion requise.");
}
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
  @Get("home")
  home(@Req() req: Request) {
    return catalogue(this.runtime, req).home();
  }
  @Post("guest-sessions")
  @HttpCode(201)
  async guest(@Req() req: Request) {
    if (!this.runtime.signing)
      throw new Problem(503, "UPSTREAM_UNAVAILABLE", "Signature non configurée.");
    return this.runtime.identities.issueGuest(
      this.runtime.signing,
      req.ip || req.socket.remoteAddress || "unknown",
    );
  }
  @Get("conversations")
  async list(@Req() req: Request) {
    const principal = await user(this.runtime, req);
    const limit = Number(req.query.limit ?? "20");
    const cursor = req.query.cursor;
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100 ||
      (cursor !== undefined && (typeof cursor !== "string" || !cursor))
    )
      throw new Problem(400, "INVALID_REQUEST", "Pagination invalide.");
    return this.runtime.conversations.list(
      principal.userRef,
      limit,
      cursor as string | undefined,
    );
  }
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
      (typeof cursor !== "string" || !cursor || cursor.length > 64)
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
  @Post("conversations/:id/attach")
  @HttpCode(200)
  async attach(
    @Param("id") id: string,
    @Req() req: Request,
    @Body() body: Schemas["AttachInput"],
  ) {
    validate("AttachInput", body);
    const principal = await user(this.runtime, req);
    loggedIn(principal);
    const guest = await this.runtime.identities.inspectGuest(
      await verifyIdentity("Bearer " + body.guestToken, this.runtime.auth),
    );
    return this.runtime.conversations.attach(
      principal,
      id,
      guest,
      (userRef, db) => this.runtime.identities.consumeGuest(userRef, db),
    );
  }
  @Post("conversations/:id/mandates")
  async grant(
    @Param("id") id: string,
    @Req() req: Request,
    @Body() body: Schemas["ConsentInput"],
  ) {
    const principal = await user(this.runtime, req);
    loggedIn(principal);
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
    loggedIn(principal);
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
  @Get("cases")
  async cases(@Req() req: Request) {
    const principal = await user(this.runtime, req);
    loggedIn(principal);
    return catalogue(this.runtime, req).cases(principal.userRef, xroadQuery(req, ["cursor", "limit"]));
  }
  @Get("cases/:caseId")
  async oneCase(@Param("caseId") caseId: string, @Req() req: Request) {
    const principal = await user(this.runtime, req);
    loggedIn(principal);
    return catalogue(this.runtime, req).case(principal.userRef, caseId);
  }
  @Get("cases/:caseId/documents/:documentId")
  async caseDocument(
    @Param("caseId") caseId: string,
    @Param("documentId") documentId: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const principal = await user(this.runtime, req);
    loggedIn(principal);
    const xroad = catalogue(this.runtime, req);
    const [file, item] = await Promise.all([
      xroad.document(principal.userRef, caseId, documentId),
      xroad.case(principal.userRef, caseId) as Promise<Schemas["Case"]>,
    ]);
    res.setHeader("Content-Type", file.mimeType);
    res.setHeader(
      "Content-Disposition",
      documentDisposition(item?.documents, documentId, file.mimeType),
    );
    res.setHeader("Cache-Control", "no-store");
    res.send(file.bytes);
  }
  @Post("files")
  @HttpCode(201)
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
    await service(this.runtime, req, "tooling", "events:publish");
    validate("Event", event);
    return this.runtime.conversations.ingest(event, key(req));
  }
  @Get("files/:id")
  async file(@Param("id") id: string, @Req() req: Request) {
    await service(this.runtime, req, "tooling", "files:read");
    if (!this.runtime.files)
      throw new Problem(503, "UPSTREAM_UNAVAILABLE", "Stockage non configuré.");
    const owner = req.get("X-User-Ref");
    if (!owner) throw new Problem(400, "INVALID_REQUEST", "X-User-Ref requis.");
    return this.runtime.files.metadata(id, owner);
  }
  @Get("files/:id/content")
  async fileContent(@Param("id") id: string, @Req() req: Request, @Res() res: Response) {
    await service(this.runtime, req, "tooling", "files:read");
    const owner = req.get("X-User-Ref");
    if (!owner || !this.runtime.files)
      throw new Problem(404, "NOT_FOUND", "Pièce introuvable.");
    const value = await this.runtime.files.readOwned(id, owner);
    res.setHeader("Content-Type", value.file.mimeType);
    res.setHeader("Content-Disposition", "attachment");
    res.setHeader("Cache-Control", "no-store");
    res.send(value.bytes);
  }
}
