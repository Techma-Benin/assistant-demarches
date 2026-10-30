import type { Request } from "express";
import type { Pool, PoolClient } from "pg";
import { scopes, verifyIdentity, type AuthOptions } from "./auth.js";
import { Problem } from "./domain.js";

export type DepartmentPermission = "dept:read" | "dept:write" | "users:manage" |
  "admin:super" | "operator:read" | "operator:write";
export type DepartmentRole = "agent" | "admin";
export type DepartmentPrincipal = {
  subject: string;
  departmentIds: string[];
  departmentRoles: Record<string, DepartmentRole>;
  superAdmin: boolean;
  permissions: Set<DepartmentPermission>;
  registered: boolean;
  displayName: string;
  email?: string;
  photoUrl?: string;
  /** Verified dedicated claims, retained only for refresh inside a mutation. */
  operatorClaims?: ReadonlySet<"operator:read" | "operator:write">;
};
type Queryable = Pick<Pool | PoolClient, "query">;
const businessPermissions: DepartmentPermission[] = ["dept:read", "dept:write", "users:manage", "admin:super"];

function permissions(roles: Record<string, DepartmentRole>, superAdmin: boolean): Set<DepartmentPermission> {
  if (superAdmin) return new Set(businessPermissions);
  const result = new Set<DepartmentPermission>();
  if (Object.keys(roles).length) ["dept:read", "dept:write"].forEach(value => result.add(value as DepartmentPermission));
  if (Object.values(roles).includes("admin")) result.add("users:manage");
  return result;
}

/** Re-resolve assignments for every request, including disabled accounts whose JWT is still valid. */
export async function refreshDepartmentPrincipal(db: Queryable, fallback: DepartmentPrincipal): Promise<DepartmentPrincipal> {
  // A single statement observes account state and assignments in the same snapshot.
  const row = (await db.query(
    "SELECT u.*,COALESCE((SELECT jsonb_object_agg(m.department_id,m.role) FROM backend_admin_memberships m JOIN backend_departments d ON d.id=m.department_id WHERE m.subject=u.subject AND m.active AND d.active),'{}'::jsonb) AS department_roles FROM backend_admin_users u WHERE u.subject=$1", [fallback.subject],
  )).rows[0];
  if (!row) return fallback;
  if (!row.active) throw new Problem(403, "FORBIDDEN", "Compte administratif désactivé.");
  const departmentRoles = row.department_roles as Record<string, DepartmentRole>;
  const grants = permissions(departmentRoles, row.super_admin);
  for (const permission of ["operator:read", "operator:write"] as const)
    if (fallback.operatorClaims?.has(permission) && row.operator_permissions.includes(permission)) grants.add(permission);
  return {
    subject: row.subject, departmentIds: Object.keys(departmentRoles), departmentRoles,
    superAdmin: row.super_admin, permissions: grants, registered: true,
    operatorClaims: fallback.operatorClaims,
    displayName: row.display_name, ...(row.email ? { email: row.email } : {}), ...(row.photo_url ? { photoUrl: row.photo_url } : {}),
  };
}

export function assertDepartmentPermission(principal: DepartmentPrincipal, permission?: DepartmentPermission, departmentId?: string): void {
  if (!permission) return;
  if (!principal.permissions.has(permission)) throw new Problem(403, "FORBIDDEN", "Permission administrative insuffisante.");
  // Global business administration widens department scope, never the set of
  // technical permissions. Operators still need their dedicated grants.
  if (principal.superAdmin) return;
  if (departmentId) {
    const role = principal.departmentRoles[departmentId];
    if (!role || (permission === "users:manage" && role !== "admin"))
      throw new Problem(403, "FORBIDDEN", "Département hors de votre périmètre.");
  }
}

/** Signed legacy claims are supported until the subject is enrolled in the local directory.
 * Once enrolled, only directory assignments grant rights; token claims cannot enlarge them.
 */
export async function requireDepartmentPrincipal(
  req: Pick<Request, "get">, auth: AuthOptions, pool: Queryable,
  permission?: DepartmentPermission, departmentId?: string,
): Promise<DepartmentPrincipal> {
  const payload = await verifyIdentity(req.get("authorization"), auth), signed = scopes(payload);
  const superAdmin = signed.has("admin:super");
  const role: DepartmentRole = signed.has("admin:write") || signed.has("users:manage") ? "admin" : "agent";
  const isAdministrator = superAdmin || ["admin:read", "admin:write", "users:manage", "dept:read", "dept:write"].some(s => signed.has(s));
  const departmentRoles: Record<string, DepartmentRole> = {};
  if (isAdministrator && typeof payload.administrationId === "string" && payload.administrationId) departmentRoles[payload.administrationId] = role;
  const fallback: DepartmentPrincipal = {
    subject: payload.sub!, departmentIds: Object.keys(departmentRoles), departmentRoles, superAdmin,
    permissions: permissions(departmentRoles, superAdmin), registered: false,
    operatorClaims: new Set((["operator:read", "operator:write"] as const).filter(permission => signed.has(permission))),
    displayName: typeof payload.name === "string" && payload.name.trim() ? payload.name.trim().slice(0, 200) : payload.sub!.slice(0, 200),
    ...(typeof payload.email === "string" && payload.email.length <= 254 ? { email: payload.email } : {}),
  };
  // Legacy configuration scopes remain aliases only for signed, unenrolled service
  // identities; enrolled operators require explicit operator:* plus database grants.
  for (const permission of ["operator:read", "operator:write"] as const)
    if (signed.has(permission)) fallback.permissions.add(permission);
  if (fallback.departmentIds.length && signed.has("admin:read")) fallback.permissions.add("operator:read");
  if (fallback.departmentIds.length && signed.has("admin:write")) fallback.permissions.add("operator:write");
  if (!superAdmin && !signed.has("admin:write") && !signed.has("dept:write")) fallback.permissions.delete("dept:write");
  const principal = await refreshDepartmentPrincipal(pool, fallback);
  if (!principal.superAdmin && !principal.departmentIds.length && !["operator:read", "operator:write"].some(p => principal.permissions.has(p as DepartmentPermission)))
    throw new Problem(403, "FORBIDDEN", "Affectation administrative requise.");
  assertDepartmentPermission(principal, permission, departmentId);
  return principal;
}
