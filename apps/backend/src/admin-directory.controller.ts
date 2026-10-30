import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Put, Req } from "@nestjs/common";
import type { Request } from "express";
import type { Pool } from "pg";
import type { AuthOptions } from "./auth.js";
import { AdminDirectory, type DepartmentInput, type DepartmentUpdate, type ProfileUpdate, type UserInput, type UserUpdate } from "./admin-directory.js";
import { requireDepartmentPrincipal, type DepartmentPermission } from "./department-auth.js";
import { Problem } from "./domain.js";
import { idempotencyKey } from "./transactions.js";

export const ADMIN_DIRECTORY_RUNTIME = Symbol("ADMIN_DIRECTORY_RUNTIME");
export type AdminDirectoryRuntime = { pool: Pool; auth: AuthOptions; directory: AdminDirectory };

function pagination(req: Request, users = false) {
  const { limit = "20", cursor, departmentId, ...other } = req.query;
  if (Object.keys(other).length || typeof limit !== "string" || !/^\d+$/.test(limit) || Number(limit) < 1 || Number(limit) > 100 ||
    (cursor !== undefined && (typeof cursor !== "string" || !cursor || cursor.length > 2048)) ||
    (departmentId !== undefined && (!users || typeof departmentId !== "string" || !departmentId)))
    throw new Problem(400, "INVALID_REQUEST", "Filtres ou pagination invalides.");
  return { limit: Number(limit), ...(typeof cursor === "string" ? { cursor } : {}), ...(typeof departmentId === "string" ? { departmentId } : {}) };
}

@Controller("v1/admin")
export class AdminDirectoryController {
  constructor(@Inject(ADMIN_DIRECTORY_RUNTIME) private runtime: AdminDirectoryRuntime) {}
  private principal(req: Request, permission?: DepartmentPermission, departmentId?: string) {
    return requireDepartmentPrincipal(req, this.runtime.auth, this.runtime.pool, permission, departmentId);
  }
  private key(req: Request) { return idempotencyKey(req.get("Idempotency-Key")); }
  private trace(req: Request) { return req.get("traceparent") ?? ""; }
  @Get("me")
  async me(@Req() req: Request) {
    if (Object.keys(req.query).length) throw new Problem(400, "INVALID_REQUEST", "Aucun filtre attendu.");
    return this.runtime.directory.me(await this.principal(req));
  }
  @Put("me")
  async updateMe(@Req() req: Request, @Body() body: ProfileUpdate) {
    return this.runtime.directory.updateMe(await this.principal(req), body, this.key(req), this.trace(req));
  }
  @Get("departments")
  async departments(@Req() req: Request) {
    return this.runtime.directory.departments(await this.principal(req, "dept:read"), pagination(req));
  }
  @Post("departments")
  async createDepartment(@Req() req: Request, @Body() body: DepartmentInput) {
    return this.runtime.directory.createDepartment(await this.principal(req, "admin:super"), body, this.key(req), this.trace(req));
  }
  @Put("departments/:id")
  async updateDepartment(@Req() req: Request, @Param("id") id: string, @Body() body: DepartmentUpdate) {
    return this.runtime.directory.updateDepartment(await this.principal(req, "admin:super"), id, body, this.key(req), this.trace(req));
  }
  @Get("users")
  async users(@Req() req: Request) {
    const options = pagination(req, true);
    return this.runtime.directory.users(await this.principal(req, "users:manage", options.departmentId), options);
  }
  @Post("users")
  async createUser(@Req() req: Request, @Body() body: UserInput) {
    return this.runtime.directory.createUser(await this.principal(req, "users:manage"), body, this.key(req), this.trace(req));
  }
  @Put("users/:subject")
  async updateUser(@Req() req: Request, @Param("subject") subject: string, @Body() body: UserUpdate) {
    return this.runtime.directory.updateUser(await this.principal(req, "users:manage"), subject, body, this.key(req), this.trace(req));
  }
  @Delete("users/:subject")
  @HttpCode(204)
  async deactivateUser(@Req() req: Request, @Param("subject") subject: string) {
    if (req.body !== undefined) throw new Problem(400, "INVALID_REQUEST", "DELETE sans corps.");
    await this.runtime.directory.deactivateUser(await this.principal(req, "users:manage"), subject, this.key(req), this.trace(req));
  }
}
