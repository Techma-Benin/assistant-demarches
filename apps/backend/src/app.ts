import "reflect-metadata";
import { randomBytes } from "node:crypto";
import {
  Body,
  Controller,
  Delete,
  HttpCode,
  Post,
  Get,
  HttpException,
  Inject,
  Module,
  Param,
  Put,
  Req,
  type ArgumentsHost,
  type ExceptionFilter,
} from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { Request, Response, NextFunction } from "express";
import type { Pool } from "pg";
import { raw } from "express";
import { authenticate, type AuthOptions } from "./auth.js";
import {
  Problem,
  type Config,
  type Principal,
  type Resource,
  configId,
  validate,
} from "./domain.js";
import { McpConnections, type McpServer } from "./mcp-connections.js";
import { Settings } from "./settings.js";
import {
  ConversationController,
  InternalController,
  RUNTIME,
  type Runtime,
} from "./routes.js";
import { attachSockets } from "./sockets.js";
import { attachDocumentation } from "./documentation.js";

type AdminRequest = Request & { principal: Principal };
const AUTH = Symbol("ADMIN_AUTH");
const DB = Symbol("DATABASE");
function resource(value: string): Resource {
  if (value !== "models" && value !== "tools" && value !== "procedures")
    throw new Problem(404, "NOT_FOUND", "Route non implémentée.");
  return value;
}
class ProblemFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const req = context.getRequest<Request>();
    const res = context.getResponse<Response>();
    const parserType = (error as { type?: unknown })?.type;
    const parserStatus =
      parserType === "entity.too.large"
        ? 413
        : parserType === "entity.parse.failed" ||
            parserType === "request.aborted" ||
            parserType === "request.size.invalid"
          ? 400
          : parserType === "encoding.unsupported"
            ? 415
            : undefined;
    const status =
      error instanceof Problem
        ? error.status
        : error instanceof HttpException
          ? error.getStatus()
          : (parserStatus ?? 503);
    const code =
      error instanceof Problem
        ? error.code
        : status === 404
          ? "NOT_FOUND"
          : status === 400
            ? "INVALID_REQUEST"
            : status === 413
              ? "FILE_TOO_LARGE"
              : status === 415
                ? "UNSUPPORTED_MEDIA_TYPE"
                : "UPSTREAM_UNAVAILABLE";
    const detail =
      error instanceof Problem
        ? error.message
        : status === 503
          ? "Service temporairement indisponible."
          : "Requête refusée.";
    const trace = /^00-([a-f0-9]{32})-/.exec(req.get("traceparent") ?? "")?.[1];
    if (status === 503) res.setHeader("Retry-After", "1");
    res
      .status(status)
      .type("application/problem+json")
      .json({
        type: "about:blank",
        title: code,
        status,
        code,
        detail,
        traceId:
          trace && !/^0+$/.test(trace)
            ? trace
            : randomBytes(16).toString("hex"),
      });
  }
}
@Controller("health")
class HealthController {
  constructor(@Inject(DB) private pool: Pool) {}
  @Get()
  async health() {
    await this.pool
      .query(
        "SELECT name FROM backend_migrations WHERE name='005_action_pause.sql'",
      )
      .then((result) => {
        if (!result.rowCount) throw new Error("Missing migration");
      });
    return { status: "ok", service: "backend" };
  }
}
@Controller("v1/admin")
class AdminController {
  constructor(
    private settings: Settings,
    private mcp: McpConnections,
    @Inject(AUTH) private auth: AuthOptions,
  ) {}
  private async principal(req: Request, scope: string): Promise<Principal> {
    const principal = await authenticate(req.get("authorization"), this.auth);
    if (!principal.scopes.has(scope))
      throw new Problem(
        403,
        "FORBIDDEN",
        "Permission administrateur insuffisante.",
      );
    return principal;
  }
  @Get("mcp-servers")
  async servers(@Req() req: AdminRequest) {
    const principal = await this.principal(req, "admin:read");
    const { limit = "20", cursor, ...unknown } = req.query;
    if (Object.keys(unknown).length || typeof limit !== "string" ||
        !/^\d+$/.test(limit) || Number(limit) < 1 || Number(limit) > 100 ||
        (cursor !== undefined && (typeof cursor !== "string" || cursor.length > 4096)))
      throw new Problem(400, "INVALID_REQUEST", "Pagination invalide.");
    return this.mcp.list(principal.administrationId, Number(limit), cursor as string | undefined);
  }
  @Post("mcp-servers")
  async addServer(@Req() req: AdminRequest, @Body() body: McpServer) {
    const principal = await this.principal(req, "admin:write");
    return this.mcp.mutate(principal, body?.id, body, "POST", this.key(req), req.get("traceparent")!);
  }
  @Get("mcp-servers/:id")
  async server(@Req() req: AdminRequest, @Param("id") id: string) {
    const principal = await this.principal(req, "admin:read");
    return this.mcp.get(principal.administrationId, id);
  }
  @Put("mcp-servers/:id")
  async putServer(@Req() req: AdminRequest, @Param("id") id: string, @Body() body: McpServer) {
    const principal = await this.principal(req, "admin:write");
    return this.mcp.mutate(principal, id, body, "PUT", this.key(req), req.get("traceparent")!);
  }
  @Delete("mcp-servers/:id")
  @HttpCode(204)
  async deleteServer(@Req() req: AdminRequest, @Param("id") id: string) {
    const principal = await this.principal(req, "admin:write");
    if (req.body !== undefined)
      throw new Problem(400, "INVALID_REQUEST", "DELETE sans corps.");
    await this.mcp.mutate(principal, id, null, "DELETE", this.key(req), req.get("traceparent")!);
  }
  @Post("mcp-servers/:id/discover")
  @HttpCode(200)
  async discover(@Req() req: AdminRequest, @Param("id") id: string) {
    const principal = await this.principal(req, "admin:write");
    if (req.body && Object.keys(req.body).length)
      throw new Problem(400, "INVALID_REQUEST", "Découverte sans paramètres.");
    return this.mcp.discover(principal, id, req.get("traceparent")!);
  }
  @Get("mcp-servers/:id/tools")
  async serverTools(@Req() req: AdminRequest, @Param("id") id: string) {
    const principal = await this.principal(req, "admin:read");
    return this.mcp.tools(principal.administrationId, id);
  }
  @Put("mcp-servers/:id/tools/:name")
  async permission(
    @Req() req: AdminRequest, @Param("id") id: string, @Param("name") name: string,
    @Body() body: { enabled: boolean; requiresMandate: boolean },
  ) {
    const principal = await this.principal(req, "admin:write");
    return this.mcp.permission(principal, id, name, body, req.get("traceparent")!);
  }
  @Get(":resource")
  async list(@Param("resource") value: string, @Req() req: AdminRequest) {
    const principal = await this.principal(req, "admin:read");
    if (value === "metrics") return this.settings.metrics(principal);
    const { limit = "20", cursor, ...unknown } = req.query;
    if (
      Object.keys(unknown).length ||
      typeof limit !== "string" ||
      !/^\d+$/.test(limit) ||
      Number(limit) < 1 ||
      Number(limit) > 100 ||
      (cursor !== undefined &&
        (typeof cursor !== "string" || !cursor || cursor.length > 4096))
    )
      throw new Problem(400, "INVALID_REQUEST", "Pagination invalide.");
    if (value === "conversations" || value === "audit")
      return this.settings.activity(
        principal,
        value,
        Number(limit),
        cursor as string | undefined,
      );
    return this.settings.list(
      principal,
      resource(value),
      Number(limit),
      cursor as string | undefined,
    );
  }
  @Get(":resource/:id")
  async get(@Param("resource") value: string, @Param("id") id: string, @Req() req: AdminRequest) {
    return this.settings.get(await this.principal(req, "admin:read"), resource(value), id);
  }
  private key(req: Request) {
    const key = req.get("Idempotency-Key") ?? "";
    if (key.length < 8 || key.length > 128)
      throw new Problem(400, "INVALID_REQUEST", "Idempotency-Key requis (8 à 128 caractères).");
    return key;
  }
  @Post(":resource")
  async create(@Param("resource") value: string, @Body() body: Config, @Req() req: AdminRequest) {
    const principal = await this.principal(req, "admin:write");
    const kind = resource(value);
    validate(kind === "models" ? "ModelConfig" : kind === "tools" ? "ToolConfig" : "Procedure", body);
    return this.settings.mutate(principal, kind, configId(body), body, this.key(req), req.get("traceparent")!, "POST");
  }
  @Delete(":resource/:id")
  @HttpCode(204)
  async remove(@Param("resource") value: string, @Param("id") id: string, @Req() req: AdminRequest) {
    const principal = await this.principal(req, "admin:write");
    if (req.body !== undefined)
      throw new Problem(400, "INVALID_REQUEST", "DELETE ne reçoit pas de corps.");
    await this.settings.mutate(principal, resource(value), id, null, this.key(req), req.get("traceparent")!, "DELETE");
  }
  @Put(":resource/:id")
  async update(
    @Param("resource") value: string,
    @Param("id") id: string,
    @Body() body: Config,
    @Req() req: AdminRequest,
  ) {
    const principal = await this.principal(req, "admin:write");
    const key = req.get("Idempotency-Key") ?? "";
    if (key.length < 8 || key.length > 128)
      throw new Problem(
        400,
        "INVALID_REQUEST",
        "Idempotency-Key requis (8 à 128 caractères).",
      );
    return this.settings.update(
      principal,
      resource(value),
      id,
      body,
      key,
      req.get("traceparent")!,
    );
  }
}
export async function createBackend(options: {
  pool: Pool;
  mcpGateway?: import("./tooling.js").ToolingPort;
  auth: AuthOptions;
  allowedMcpUrls: ReadonlySet<string>;
  corsOrigins?: string[];
  runtime?: Runtime;
  developmentTokens?: Record<string, string>;
}) {
  let closeSockets = () => {};
  @Module({
    controllers: [
      HealthController,
      AdminController,
      ...(options.runtime ? [ConversationController, InternalController] : []),
    ],
    providers: [
      {provide:McpConnections,useValue:new McpConnections(options.pool,options.allowedMcpUrls,options.mcpGateway??options.runtime?.tooling)},
      { provide: DB, useValue: options.pool },
      { provide: AUTH, useValue: options.auth },
      {
        provide: Settings,
        useValue: new Settings(options.pool, options.allowedMcpUrls),
      },
      ...(options.runtime
        ? [{ provide: RUNTIME, useValue: options.runtime }]
        : []),
      {
        provide: "SOCKET_LIFECYCLE",
        useValue: {
          onModuleDestroy() {
            closeSockets();
          },
        },
      },
    ],
  })
  class BackendModule {}
  const app = await NestFactory.create(BackendModule, { logger: false });
  attachDocumentation(app.getHttpAdapter().getInstance(), options.developmentTokens);
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (req.path === "/health" || req.method === "OPTIONS") return next();
    const match = /^00-([a-f0-9]{32})-([a-f0-9]{16})-0[01]$/.exec(
      req.get("traceparent") ?? "",
    );
    if (!match || /^0+$/.test(match[1]) || /^0+$/.test(match[2]))
      return next(
        new Problem(400, "INVALID_REQUEST", "traceparent valide requis."),
      );
    next();
  });
  app.useGlobalFilters(new ProblemFilter());
  app.use(
    "/v1/files",
    raw({ type: "application/octet-stream", limit: "10mb" }),
  );
  if (options.corsOrigins?.length) {
    if (options.corsOrigins.includes("*"))
      throw new Error("CORS wildcard is not allowed.");
    app.enableCors({ origin: options.corsOrigins, credentials: false });
  }
  await app.init();
  if (options.runtime)
    closeSockets = attachSockets(
      app.getHttpServer(),
      options.runtime.conversations,
      options.corsOrigins ?? [],
    );
  return app;
}
