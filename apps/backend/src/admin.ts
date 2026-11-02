import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Req,
  Res,
} from "@nestjs/common";
import type { Request, Response } from "express";
import type { Pool } from "pg";
import { authenticate, type AuthOptions } from "./auth.js";
import { Problem, validate, type Schemas } from "./domain.js";
import { KeycloakAdmin } from "./keycloak-admin.js";
import { RUNTIME, type Runtime } from "./routes.js";
import { XroadClient } from "./xroad.js";
import { idempotencyKey } from "./transactions.js";

const AUTH = Symbol("ADMIN_CONSOLE_AUTH");
export const ADMIN_AUTH = AUTH;

function xroad(runtime: Runtime) {
  if (!runtime.xroadUrl || !runtime.serviceTokens)
    throw new Problem(503, "UPSTREAM_UNAVAILABLE", "X-Road non configuré.");
  return new XroadClient(runtime.xroadUrl, () => runtime.serviceTokens!.get("xroad:administer"));
}

function query(req: Request, extra: Record<string, string | undefined> = {}) {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries({ ...req.query, ...extra })) {
    if (value === undefined || value === "") continue;
    if (Array.isArray(value) || typeof value === "object")
      throw new Problem(400, "INVALID_REQUEST", "Paramètre invalide.");
    params.set(name, String(value));
  }
  const encoded = params.toString();
  return encoded ? "?" + encoded : "";
}

@Controller("v1/admin")
export class AdminConsoleController {
  constructor(
    @Inject(RUNTIME) private runtime: Runtime,
    @Inject(AUTH) private auth: AuthOptions,
  ) {}
  private async official(req: Request) {
    return authenticate(req.get("authorization"), this.auth, "official");
  }
  private client(req: Request) {
    return xroad(this.runtime);
  }
  @Get("me")
  me(@Req() req: Request) {
    return this.official(req).then((principal) => this.client(req).me(principal.subject));
  }
  @Put("me")
  async updateMe(@Req() req: Request, @Body() body: Schemas["ProfileUpdate"]) {
    const principal = await this.official(req);
    validate("ProfileUpdate", body);
    return this.client(req).updateMe(principal.subject, body);
  }
  @Put("me/avatar")
  async avatar(@Req() req: Request, @Body() body: Buffer, @Res({ passthrough: false }) res: Response) {
    const principal = await this.official(req);
    const mime = req.get("X-File-Mime-Type") ?? "";
    if (mime !== "image/jpeg" && mime !== "image/png")
      throw new Problem(415, "UNSUPPORTED_MEDIA_TYPE", "image/jpeg ou image/png requis.");
    if (!Buffer.isBuffer(body) || !body.length)
      throw new Problem(400, "INVALID_REQUEST", "Fichier vide.");
    if (body.length > 2 * 1024 * 1024)
      throw new Problem(413, "FILE_TOO_LARGE", "Photo supérieure à 2 Mio.");
    if (!this.runtime.files)
      throw new Problem(503, "UPSTREAM_UNAVAILABLE", "Stockage non configuré.");
    const me = await this.client(req).me(principal.subject);
    await this.runtime.files.storeAvatar(me.official.id, body, mime);
    const publicUrl = this.runtime.publicUrl ?? "http://127.0.0.1:" + req.socket.localPort;
    const avatarUrl = new URL("/v1/admin/avatars/" + encodeURIComponent(me.official.id), publicUrl).href;
    const official = await this.client(req).setAvatar(principal.subject, avatarUrl);
    res.status(200).json(official);
  }
  @Get("avatars/:officialId")
  async getAvatar(@Param("officialId") officialId: string, @Req() req: Request, @Res() res: Response) {
    await this.official(req);
    if (!this.runtime.files)
      throw new Problem(503, "UPSTREAM_UNAVAILABLE", "Stockage non configuré.");
    const { file, bytes } = await this.runtime.files.readAvatar(officialId);
    res.setHeader("Content-Type", file.mimeType);
    res.setHeader("Cache-Control", "no-store");
    res.send(bytes);
  }
  @Get("administrations")
  administrations(@Req() req: Request) {
    return this.official(req).then((principal) => this.client(req).administrations(principal.subject, query(req)));
  }
  @Get("officials")
  officials(@Req() req: Request) {
    return this.official(req).then((principal) => this.client(req).listOfficials(principal.subject, query(req)));
  }
  @Post("officials")
  async createOfficial(@Req() req: Request, @Body() body: Schemas["OfficialInput"]) {
    const principal = await this.official(req);
    const me = await this.client(req).me(principal.subject);
    if (!me.permissions.includes("officials:manage"))
      throw new Problem(403, "FORBIDDEN", "Création d’agent réservée aux administrateurs.");
    validate("OfficialInput", body);
    const issuer = this.runtime.auth.issuer;
    if (!this.runtime.serviceTokens)
      throw new Problem(503, "UPSTREAM_UNAVAILABLE", "Identité de service non configurée.");
    const keycloak = new KeycloakAdmin(issuer, () => this.runtime.serviceTokens!.get("keycloak-admin"));
    const account = await keycloak.createUser({ email: body.email, displayName: body.displayName });
    try {
      const official = await this.client(req).createOfficial(
        principal.subject,
        { ...body, subject: account.subject },
        idempotencyKey(req.get("Idempotency-Key"), { required: false }),
      );
      return { official, temporaryPassword: account.temporaryPassword };
    } catch (error) {
      await keycloak.disableUser(account.subject).catch(() => undefined);
      throw error;
    }
  }
  @Put("officials/:officialId")
  async updateOfficial(
    @Param("officialId") officialId: string,
    @Req() req: Request,
    @Body() body: Schemas["OfficialUpdate"],
  ) {
    const principal = await this.official(req);
    validate("OfficialUpdate", body);
    return this.client(req).updateOfficial(
      principal.subject,
      officialId,
      body,
      idempotencyKey(req.get("Idempotency-Key"), { required: false }),
    );
  }
  @Get("cases")
  cases(@Req() req: Request) {
    return this.official(req).then((principal) => this.client(req).listCases(principal.subject, query(req)));
  }
  @Get("cases/:caseId")
  oneCase(@Param("caseId") caseId: string, @Req() req: Request) {
    return this.official(req).then((principal) => this.client(req).getCase(principal.subject, caseId));
  }
  @Post("cases/:caseId/actions")
  @HttpCode(200)
  async act(@Param("caseId") caseId: string, @Req() req: Request, @Body() body: Schemas["CaseActionInput"]) {
    const principal = await this.official(req);
    validate("CaseActionInput", body);
    return this.client(req).actOnCase(principal.subject, caseId, body, idempotencyKey(req.get("Idempotency-Key")));
  }
  @Get("cases/:caseId/documents/:documentId")
  async caseDocument(
    @Param("caseId") caseId: string,
    @Param("documentId") documentId: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const principal = await this.official(req);
    const file = await this.client(req).officialDocument(principal.subject, caseId, documentId);
    res.setHeader("Content-Type", file.mimeType);
    res.setHeader("Cache-Control", "no-store");
    res.send(file.bytes);
  }
  @Get("dashboard")
  async dashboard(@Req() req: Request) {
    const principal = await this.official(req);
    const metrics = await this.client(req).metrics(principal.subject, query(req));
    const unanswered = await this.runtime.pool.query(
      "SELECT count(*)::int AS n FROM backend_unanswered WHERE status='open'",
    );
    return { metrics, unansweredOpen: unanswered.rows[0]?.n ?? 0 };
  }
  @Get("activity")
  activity(@Req() req: Request) {
    return this.official(req).then((principal) => this.client(req).activity(principal.subject, query(req)));
  }
  @Get("unanswered")
  async unanswered(@Req() req: Request) {
    await this.official(req);
    const limit = Number(req.query.limit ?? "20");
    const cursor = req.query.cursor;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new Problem(400, "INVALID_REQUEST", "Pagination invalide.");
    if (cursor !== undefined && (typeof cursor !== "string" || !cursor))
      throw new Problem(400, "INVALID_REQUEST", "Curseur invalide.");
    const after = cursor ?? "";
    const rows = (
      await this.runtime.pool.query(
        "SELECT * FROM backend_unanswered WHERE id>$1 ORDER BY id LIMIT $2",
        [after, limit + 1],
      )
    ).rows;
    const page = rows.slice(0, limit);
    return {
      items: page.map(toUnanswered),
      nextCursor: rows.length > limit ? page.at(-1).id : null,
    };
  }
  @Post("unanswered/:unansweredId/resolve")
  @HttpCode(200)
  async resolve(@Param("unansweredId") unansweredId: string, @Req() req: Request) {
    await this.official(req);
    const updated = await this.runtime.pool.query(
      "UPDATE backend_unanswered SET status='resolved', resolved_at=now() WHERE id=$1 RETURNING *",
      [unansweredId],
    );
    if (!updated.rowCount) throw new Problem(404, "NOT_FOUND", "Question introuvable.");
    return toUnanswered(updated.rows[0]);
  }
}

function toUnanswered(row: {
  id: string;
  administration_id: string | null;
  theme: string | null;
  reason: string;
  status: string;
  created_at: Date;
  resolved_at: Date | null;
}): Schemas["UnansweredEntry"] {
  const reasons: Record<string, Schemas["UnansweredEntry"]["reason"]> = {
    missing_source: "no_source",
    no_source: "no_source",
    no_procedure_found: "no_procedure_found",
    tool_failure: "tool_failed",
    tool_failed: "tool_failed",
    provider_failure: "model_unavailable",
    model_unavailable: "model_unavailable",
    invalid_reply: "model_unavailable",
  };
  return {
    id: row.id,
    administrationId: row.administration_id,
    theme: row.theme,
    reason: reasons[row.reason] ?? "no_source",
    status: row.status === "resolved" ? "resolved" : "open",
    createdAt: new Date(row.created_at).toISOString(),
    resolvedAt: row.resolved_at ? new Date(row.resolved_at).toISOString() : null,
  };
}

export { AUTH as ADMIN_CONSOLE_AUTH };
