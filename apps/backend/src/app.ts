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
  Optional,
  Param,
  Put,
  Req,
  Res,
  type ArgumentsHost,
  type ExceptionFilter,
} from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { Request, Response, NextFunction } from "express";
import type { Pool } from "pg";
import { raw } from "express";
import { authenticate, type AuthOptions } from "./auth.js";
import { probeReadiness, type ReadinessOptions } from "./readiness.js";
import {
  Problem,
  type Config,
  type Principal,
  type Resource,
  configId,
} from "./domain.js";
import { McpConnections, type McpServer } from "./mcp-connections.js";
import { modelRole } from "./model-env.js";
import { Settings, takeModelWrite } from "./settings.js";
import { idempotencyKey } from "./transactions.js";
import {
  ConversationController,
  InternalController,
  RUNTIME,
  type Runtime,
} from "./routes.js";
import { attachSockets } from "./sockets.js";
import { attachDocumentation } from "./documentation.js";
import { AdminConsoleController, ADMIN_AUTH } from "./admin.js";
import { XroadClient } from "./xroad.js";

type AdminRequest = Request & { principal: Principal };
const AUTH = Symbol("ADMIN_AUTH");
const DB = Symbol("DATABASE");
const READINESS = Symbol("READINESS");
function resource(value: string): Resource {
  if (value !== "models")
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
    if (error instanceof Problem && error.retryAfter !== undefined) res.setHeader("Retry-After", String(error.retryAfter));
    else if (status === 503) res.setHeader("Retry-After", "1");
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
  constructor(
    @Inject(DB) private pool: Pool,
    @Optional() @Inject(READINESS) private readiness?: ReadinessOptions,
  ) {}
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
  @Get("ready")
  @HttpCode(200)
  async ready(@Res({ passthrough: true }) res: Response) {
    const report = await probeReadiness(this.readiness ?? { pool: this.pool });
    if (report.status !== "ok") res.status(503);
    return report;
  }
}
@Controller("v1/operator")
class AdminController {
  constructor(
    private settings: Settings,
    private mcp: McpConnections,
    @Inject(AUTH) private auth: AuthOptions,
    @Optional() @Inject(RUNTIME) private runtime?: Runtime,
  ) {}
  private async principal(req: Request): Promise<Principal> {
    return authenticate(req.get("authorization"), this.auth, "operator");
  }
  @Get("status")
  async status(@Req() req: AdminRequest) {
    const principal = await this.principal(req);
    const models = await this.settings.list(principal, "models", 100);
    const discussion = (models.items as { id: string; label?: string; model?: string; active?: boolean; role?: string }[])
      .filter((item) => modelRole(item) === "discussion");
    const active = discussion.find((item) => item.active) ?? discussion[0];
    const servers = await this.mcp.list(principal.administrationId, 100);
    const mcpServers = [];
    for (const server of servers.items) {
      let toolCount = 0;
      try {
        toolCount = (await this.mcp.tools(principal.administrationId, server.id)).items.length;
      } catch { /* Unreachable or undiscovered connection still appears in the status. */ }
      mcpServers.push({
        id: server.id,
        name: server.name,
        enabled: server.enabled,
        reachable: server.enabled,
        toolCount,
        checkedAt: new Date().toISOString(),
      });
    }
    let administrations: unknown[] = [];
    if (this.runtime?.xroadUrl && this.runtime.serviceTokens) {
      try {
        const page = await new XroadClient(
          this.runtime.xroadUrl,
          () => this.runtime!.serviceTokens!.get("xroad:apply"),
          req.get("traceparent") ?? undefined,
        ).listAdministrations();
        administrations = (page as { items?: unknown[] }).items ?? [];
      } catch { /* Operator status stays available when X-Road is down. */ }
    }
    return {
      model: active ? { id: active.id, label: active.label ?? active.model ?? active.id, reachable: true } : null,
      mcpServers,
      administrations,
    };
  }
  @Get("mcp-servers")
  async servers(@Req() req: AdminRequest) {
    const principal = await this.principal(req);
    const { limit = "20", cursor, ...unknown } = req.query;
    if (Object.keys(unknown).length || typeof limit !== "string" ||
        !/^\d+$/.test(limit) || Number(limit) < 1 || Number(limit) > 100 ||
        (cursor !== undefined && (typeof cursor !== "string" || cursor.length > 4096)))
      throw new Problem(400, "INVALID_REQUEST", "Pagination invalide.");
    return this.mcp.list(principal.administrationId, Number(limit), cursor as string | undefined);
  }
  @Post("mcp-servers")
  async addServer(@Req() req: AdminRequest, @Body() body: McpServer) {
    const principal = await this.principal(req);
    return this.mcp.mutate(principal, body?.id, body, "POST", this.key(req), req.get("traceparent")!);
  }
  @Get("mcp-servers/:id")
  async server(@Req() req: AdminRequest, @Param("id") id: string) {
    const principal = await this.principal(req);
    return this.mcp.get(principal.administrationId, id);
  }
  @Put("mcp-servers/:id")
  async putServer(@Req() req: AdminRequest, @Param("id") id: string, @Body() body: McpServer) {
    const principal = await this.principal(req);
    return this.mcp.mutate(principal, id, body, "PUT", this.key(req), req.get("traceparent")!);
  }
  @Delete("mcp-servers/:id")
  @HttpCode(204)
  async deleteServer(@Req() req: AdminRequest, @Param("id") id: string) {
    const principal = await this.principal(req);
    if (req.body !== undefined)
      throw new Problem(400, "INVALID_REQUEST", "DELETE sans corps.");
    await this.mcp.mutate(principal, id, null, "DELETE", this.key(req), req.get("traceparent")!);
  }
  @Post("mcp-servers/:id/discover")
  @HttpCode(200)
  async discover(@Req() req: AdminRequest, @Param("id") id: string) {
    const principal = await this.principal(req);
    this.key(req);
    if (req.body && Object.keys(req.body).length)
      throw new Problem(400, "INVALID_REQUEST", "Découverte sans paramètres.");
    return this.mcp.discover(principal, id, req.get("traceparent")!);
  }
  @Get("mcp-servers/:id/tools")
  async serverTools(@Req() req: AdminRequest, @Param("id") id: string) {
    const principal = await this.principal(req);
    return this.mcp.tools(principal.administrationId, id);
  }
  @Put("mcp-servers/:id/tools/:name")
  async permission(
    @Req() req: AdminRequest, @Param("id") id: string, @Param("name") name: string,
    @Body() body: { enabled: boolean; requiresMandate: boolean },
  ) {
    const principal = await this.principal(req);
    this.key(req);
    return this.mcp.permission(principal, id, name, body, req.get("traceparent")!);
  }
  @Get(":resource")
  async list(@Param("resource") value: string, @Req() req: AdminRequest) {
    const principal = await this.principal(req);
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
    return this.settings.list(
      principal,
      resource(value),
      Number(limit),
      cursor as string | undefined,
    );
  }
  @Get(":resource/:id")
  async get(@Param("resource") value: string, @Param("id") id: string, @Req() req: AdminRequest) {
    return this.settings.get(await this.principal(req), resource(value), id);
  }
  private key(req: Request) {
    return idempotencyKey(req.get("Idempotency-Key"), { required: false });
  }
  @Post(":resource")
  async create(@Param("resource") value: string, @Body() body: Config, @Req() req: AdminRequest) {
    const principal = await this.principal(req);
    const kind = resource(value);
    const write = takeModelWrite(body);
    return this.settings.mutate(principal, kind, configId(write.model), write.model, this.key(req), req.get("traceparent")!, "POST", write.apiKey);
  }
  @Delete(":resource/:id")
  @HttpCode(204)
  async remove(@Param("resource") value: string, @Param("id") id: string, @Req() req: AdminRequest) {
    const principal = await this.principal(req);
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
    const principal = await this.principal(req);
    const write = takeModelWrite(body);
    return this.settings.update(
      principal,
      resource(value),
      id,
      write.model,
      this.key(req),
      req.get("traceparent")!,
      write.apiKey,
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
  jwks?: { keys: Record<string, unknown>[] };
  readiness?: ReadinessOptions;
}) {
  let closeSockets = () => {};
  @Controller(".well-known")
  class JwksController {
    @Get("jwks.json")
    keys() {
      return { keys: options.jwks?.keys ?? [] };
    }
  }
  @Module({
    controllers: [
      HealthController,
      JwksController,
      AdminController,
      ...(options.runtime ? [ConversationController, InternalController, AdminConsoleController] : []),
    ],
    providers: [
      {provide:McpConnections,useValue:new McpConnections(options.pool,options.allowedMcpUrls,options.mcpGateway??options.runtime?.tooling)},
      { provide: DB, useValue: options.pool },
      {
        provide: READINESS,
        useValue: options.readiness ?? { pool: options.pool },
      },
      { provide: AUTH, useValue: options.auth },
      { provide: ADMIN_AUTH, useValue: options.auth },
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
    if (req.path === "/health" || req.path === "/health/ready" || req.method === "OPTIONS") return next();
    const header = req.get("traceparent") ?? "";
    const match = /^00-([a-f0-9]{32})-([a-f0-9]{16})-0[01]$/.exec(header);
    const trace =
      match && !/^0+$/.test(match[1]) && !/^0+$/.test(match[2])
        ? header
        : `00-${randomBytes(16).toString("hex")}-${randomBytes(8).toString("hex")}-01`;
    req.headers.traceparent = trace;
    res.setHeader("traceparent", trace);
    next();
  });
  app.useGlobalFilters(new ProblemFilter());
  app.use(
    ["/v1/files", "/internal/v1/requests", "/v1/admin/me/avatar"],
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
