import type { Pool, PoolClient } from "pg";
import { Problem, canonical, fingerprint, identifier } from "./domain.js";
import { transaction, idempotencyKey } from "./transactions.js";
import { assertDepartmentPermission, refreshDepartmentPrincipal, type DepartmentPrincipal, type DepartmentRole } from "./department-auth.js";

export type Department = { id: string; name: string; code?: string; active: boolean; revision: number; createdAt: string; updatedAt: string };
export type DepartmentInput = { id: string; name: string; code?: string; active?: boolean };
export type DepartmentUpdate = { name: string; code?: string; active: boolean; revision: number };
export type Membership = { departmentId: string; role: DepartmentRole; active: boolean };
export type MembershipInput = { departmentId: string; role: DepartmentRole; active?: boolean };
export type AdminUser = {
  subject: string; displayName: string; email?: string; photoUrl?: string; active: boolean; superAdmin: boolean;
  memberships: Membership[]; revision: number; createdAt: string; updatedAt: string;
};
export type UserInput = { subject: string; displayName: string; email?: string; photoUrl?: string; superAdmin?: boolean; memberships: MembershipInput[] };
export type UserUpdate = { revision: number; displayName?: string; email?: string | null; photoUrl?: string | null; active?: boolean; superAdmin?: boolean; memberships?: MembershipInput[] };
export type ProfileUpdate = { displayName: string; email?: string | null; photoUrl?: string | null; revision: number };
export type DirectoryPage<T> = { items: T[]; nextCursor: string | null };
export type AdminProfile = Omit<AdminUser, "createdAt" | "updatedAt"> & {
  createdAt?: string; updatedAt?: string; departmentIds: string[]; permissions: string[];
  identityProvider: "oidc"; directorySource: "backend-demo-adapter";
};
type Row = Record<string, any>;
type Page = { limit?: number; cursor?: string; departmentId?: string };

function invalid(detail = "Corps non conforme au contrat."): never { throw new Problem(400, "INVALID_REQUEST", detail); }
function object(value: unknown, allowed: string[], required: string[] = []): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(k => !allowed.includes(k)) || required.some(k => !(k in value))) invalid();
}
function text(value: unknown, max: number, field: string): asserts value is string {
  if (typeof value !== "string" || !value.trim() || value !== value.trim() || value.length > max || /[\u0000-\u001f\u007f]/u.test(value)) invalid(`${field} invalide.`);
}
function departmentId(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(value)) invalid("Identifiant de département invalide.");
}
function subject(value: unknown): asserts value is string { text(value, 255, "subject"); }
function revision(value: unknown): asserts value is number { if (!Number.isSafeInteger(value) || Number(value) < 1) invalid("revision doit être un entier positif."); }
function boolean(value: unknown): asserts value is boolean { if (typeof value !== "boolean") invalid(); }
function contact(body: Record<string, unknown>) {
  if (body.email !== undefined && body.email !== null && (typeof body.email !== "string" || body.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email))) invalid("Adresse email invalide.");
  if (body.photoUrl !== undefined && body.photoUrl !== null) {
    if (typeof body.photoUrl !== "string" || body.photoUrl.length > 2048) invalid("photoUrl invalide.");
    try {
      const url = new URL(body.photoUrl as string);
      if (url.protocol !== "https:" || url.username || url.password || url.hash) invalid("photoUrl exige une URL HTTPS sans identifiants ni fragment.");
    } catch { invalid("photoUrl exige une URL HTTPS valide."); }
  }
}
function memberships(value: unknown): Membership[] {
  if (!Array.isArray(value) || value.length > 100) invalid("Affectations invalides (maximum 100).");
  const seen = new Set<string>();
  return value.map(item => {
    object(item, ["departmentId", "role", "active"], ["departmentId", "role"]);
    departmentId(item.departmentId);
    if (!["agent", "admin"].includes(item.role as string) || seen.has(item.departmentId)) invalid("Affectation dupliquée ou rôle invalide.");
    seen.add(item.departmentId);
    if (item.active !== undefined) boolean(item.active);
    return { departmentId: item.departmentId, role: item.role as DepartmentRole, active: item.active !== false };
  });
}
function department(row: Row): Department {
  return { id: row.id, name: row.name, ...(row.code ? { code: row.code } : {}), active: row.active, revision: row.revision, createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString() };
}
function adminUser(row: Row, assigned: Membership[]): AdminUser {
  return { subject: row.subject, displayName: row.display_name, ...(row.email ? { email: row.email } : {}), ...(row.photo_url ? { photoUrl: row.photo_url } : {}), active: row.active, superAdmin: row.super_admin, memberships: assigned, revision: row.revision, createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString() };
}
const managed = (principal: DepartmentPrincipal) => Object.keys(principal.departmentRoles).filter(id => principal.departmentRoles[id] === "admin");
function page(options: Page, kind: string): { limit: number; after: string } {
  const limit = options.limit ?? 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) invalid("Pagination invalide.");
  if (!options.cursor) return { limit, after: "" };
  try {
    if (options.cursor.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(options.cursor)) invalid();
    const value = JSON.parse(Buffer.from(options.cursor, "base64url").toString("utf8"));
    object(value, ["kind", "after", "departmentId"], ["kind", "after"]);
    if (value.kind !== kind || value.departmentId !== options.departmentId) invalid();
    subject(value.after);
    return { limit, after: value.after };
  } catch { return invalid("Curseur invalide."); }
}
function next(kind: string, after: string, departmentId?: string): string {
  return Buffer.from(JSON.stringify({ kind, after, ...(departmentId ? { departmentId } : {}) })).toString("base64url");
}

/** Replace this local adapter with Tooling's directory API when its contract is ready.
 * Authentication always stays with the verified OIDC issuer, never this database.
 */
export class AdminDirectory {
  constructor(private pool: Pool) {}

  private async user(db: Pool | PoolClient, id: string): Promise<AdminUser> {
    const row = (await db.query("SELECT * FROM backend_admin_users WHERE subject=$1", [id])).rows[0];
    if (!row) throw new Problem(404, "NOT_FOUND", "Utilisateur administratif introuvable.");
    const assigned = (await db.query("SELECT department_id,role,active FROM backend_admin_memberships WHERE subject=$1 ORDER BY department_id", [id])).rows.map(row => ({ departmentId: row.department_id, role: row.role as DepartmentRole, active: row.active }));
    return adminUser(row, assigned);
  }

  private visible(principal: DepartmentPrincipal, user: AdminUser): AdminUser {
    if (principal.superAdmin) return user;
    const ids = managed(principal);
    const assigned = user.memberships.filter(m => ids.includes(m.departmentId));
    if (!assigned.length) throw new Problem(404, "NOT_FOUND", "Utilisateur administratif introuvable.");
    return { ...user, memberships: assigned };
  }

  private write<T>(principal: DepartmentPrincipal, route: unknown, body: unknown, key: string, trace: string, work: (client: PoolClient, current: DepartmentPrincipal) => Promise<T>): Promise<T> {
    idempotencyKey(key);
    if (!/^00-(?!0{32}-)[a-f0-9]{32}-(?!0{16}-)[a-f0-9]{16}-[a-f0-9]{2}$/.test(trace ?? "")) invalid("traceparent valide requis.");
    return transaction(this.pool, async client => {
      // Every directory mutation uses the same lock: assignment changes and authority checks
      // are atomic, and parallel creates cannot bypass last-super-admin protection.
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('backend-admin-directory',0))");
      const current = await refreshDepartmentPrincipal(client, principal);
      // Replay visibility is bound to current grants, including a demotion that
      // occurred after this token was issued. Never return a former global view.
      const scope = canonical(["admin-directory", principal.subject, route, current.superAdmin, current.departmentRoles, [...current.permissions].sort()]);
      const digest = fingerprint(body);
      const previous = (await client.query("SELECT fingerprint,response FROM backend_idempotency WHERE scope=$1 AND key=$2 AND expires_at>now()", [scope, key])).rows[0];
      if (previous) {
        if (previous.fingerprint !== digest) throw new Problem(409, "IDEMPOTENCY_CONFLICT", "Clé réutilisée pour un contenu différent.");
        return previous.response as T;
      }
      const result = await work(client, current);
      await client.query("INSERT INTO backend_idempotency(scope,key,fingerprint,response) VALUES($1,$2,$3,$4) ON CONFLICT(scope,key) DO UPDATE SET fingerprint=excluded.fingerprint,response=excluded.response,expires_at=now()+interval '24 hours'", [scope, key, digest, JSON.stringify(result)]);
      return result;
    }).catch(error => {
      if (error?.code === "23505") throw new Problem(409, "ALREADY_EXISTS", "Cette entrée existe déjà.");
      throw error;
    });
  }

  private async audit(client: PoolClient, principal: DepartmentPrincipal, action: string, target: string, ids: string[], trace: string): Promise<void> {
    await client.query("INSERT INTO backend_admin_directory_audit(id,actor_subject,action,target,department_ids,traceparent) VALUES($1,$2,$3,$4,$5,$6)", [identifier("aud"), principal.subject, action, target, ids, trace]);
  }

  async me(principal: DepartmentPrincipal): Promise<AdminProfile> {
    const profile: Omit<AdminUser, "createdAt" | "updatedAt"> = principal.registered ? await this.user(this.pool, principal.subject) : {
      subject: principal.subject, displayName: principal.displayName, ...(principal.email ? { email: principal.email } : {}), ...(principal.photoUrl ? { photoUrl: principal.photoUrl } : {}), active: true, superAdmin: principal.superAdmin,
      memberships: principal.departmentIds.map(departmentId => ({ departmentId, role: principal.departmentRoles[departmentId], active: true })), revision: 0,
    };
    return { ...profile, departmentIds: principal.departmentIds, permissions: [...principal.permissions].sort(), identityProvider: "oidc", directorySource: "backend-demo-adapter" };
  }

  async updateMe(principal: DepartmentPrincipal, body: ProfileUpdate, key: string, trace: string): Promise<AdminProfile> {
    object(body, ["displayName", "email", "photoUrl", "revision"], ["displayName", "revision"]);
    text(body.displayName, 200, "displayName"); contact(body); revision(body.revision);
    if (!principal.registered) throw new Problem(409, "DIRECTORY_ENROLLMENT_REQUIRED", "Ce profil doit être inscrit dans l'annuaire administratif par un administrateur.");
    return this.write(principal, ["me", "PUT"], body, key, trace, async (client, actor) => {
      const saved = await this.user(client, actor.subject);
      if (saved.revision !== body.revision) throw new Problem(409, "VERSION_CONFLICT", "Le profil a été modifié; rechargez-le.");
      await client.query("UPDATE backend_admin_users SET display_name=$2,email=$3,photo_url=$4,revision=revision+1,updated_at=now() WHERE subject=$1", [actor.subject, body.displayName, body.email === undefined ? saved.email ?? null : body.email, body.photoUrl === undefined ? saved.photoUrl ?? null : body.photoUrl]);
      await this.audit(client, actor, "profile.updated", actor.subject, actor.departmentIds, trace);
      const updated = await this.user(client, actor.subject);
      return { ...updated, departmentIds: actor.departmentIds, permissions: [...actor.permissions].sort(), identityProvider: "oidc", directorySource: "backend-demo-adapter" };
    });
  }

  async departments(principal: DepartmentPrincipal, options: Page = {}): Promise<DirectoryPage<Department>> {
    assertDepartmentPermission(principal, "dept:read");
    const { limit, after } = page(options, "departments");
    const rows = (await this.pool.query("SELECT * FROM backend_departments WHERE id>$1 AND ($2::boolean OR id=ANY($3::text[])) ORDER BY id LIMIT $4", [after, principal.superAdmin, principal.departmentIds, limit + 1])).rows;
    return { items: rows.slice(0, limit).map(department), nextCursor: rows.length > limit ? next("departments", rows[limit - 1].id) : null };
  }

  async createDepartment(principal: DepartmentPrincipal, body: DepartmentInput, key: string, trace: string): Promise<Department> {
    object(body, ["id", "name", "code", "active"], ["id", "name"]); departmentId(body.id); text(body.name, 200, "name");
    if (body.code !== undefined) text(body.code, 50, "code"); if (body.active !== undefined) boolean(body.active);
    return this.write(principal, ["departments", "POST"], body, key, trace, async (client, actor) => {
      assertDepartmentPermission(actor, "admin:super");
      const row = (await client.query("INSERT INTO backend_departments(id,name,code,active) VALUES($1,$2,$3,$4) RETURNING *", [body.id, body.name, body.code ?? null, body.active !== false])).rows[0];
      await this.audit(client, actor, "department.created", body.id, [body.id], trace);
      return department(row);
    });
  }

  async updateDepartment(principal: DepartmentPrincipal, id: string, body: DepartmentUpdate, key: string, trace: string): Promise<Department> {
    departmentId(id); object(body, ["name", "code", "active", "revision"], ["name", "active", "revision"]); text(body.name, 200, "name"); boolean(body.active); revision(body.revision); if (body.code !== undefined) text(body.code, 50, "code");
    return this.write(principal, ["departments", id, "PUT"], body, key, trace, async (client, actor) => {
      assertDepartmentPermission(actor, "admin:super");
      const saved = (await client.query("SELECT * FROM backend_departments WHERE id=$1", [id])).rows[0];
      if (!saved) throw new Problem(404, "NOT_FOUND", "Département introuvable.");
      if (saved.revision !== body.revision) throw new Problem(409, "VERSION_CONFLICT", "Le département a été modifié; rechargez-le.");
      const row = (await client.query("UPDATE backend_departments SET name=$2,code=$3,active=$4,revision=revision+1,updated_at=now() WHERE id=$1 RETURNING *", [id, body.name, body.code ?? null, body.active])).rows[0];
      await this.audit(client, actor, "department.updated", id, [id], trace);
      return department(row);
    });
  }

  async users(principal: DepartmentPrincipal, options: Page = {}): Promise<DirectoryPage<AdminUser>> {
    assertDepartmentPermission(principal, "users:manage", options.departmentId);
    if (options.departmentId !== undefined) departmentId(options.departmentId);
    const { limit, after } = page(options, "users"), ids = managed(principal);
    const rows = (await this.pool.query(
      "SELECT u.subject FROM backend_admin_users u WHERE u.subject>$1 AND ($2::boolean OR EXISTS(SELECT 1 FROM backend_admin_memberships m WHERE m.subject=u.subject AND m.department_id=ANY($3::text[]))) AND ($4::text IS NULL OR EXISTS(SELECT 1 FROM backend_admin_memberships m WHERE m.subject=u.subject AND m.department_id=$4)) ORDER BY u.subject LIMIT $5",
      [after, principal.superAdmin, ids, options.departmentId ?? null, limit + 1],
    )).rows;
    const items = await Promise.all(rows.slice(0, limit).map(async row => this.visible(principal, await this.user(this.pool, row.subject))));
    return { items, nextCursor: rows.length > limit ? next("users", rows[limit - 1].subject, options.departmentId) : null };
  }

  private async checkMemberships(client: PoolClient, actor: DepartmentPrincipal, assigned: Membership[]): Promise<void> {
    for (const item of assigned) {
      assertDepartmentPermission(actor, "users:manage", item.departmentId);
      const row = (await client.query("SELECT active FROM backend_departments WHERE id=$1", [item.departmentId])).rows[0];
      if (!row) throw new Problem(404, "NOT_FOUND", "Département introuvable.");
      if (item.active && !row.active) throw new Problem(409, "INVALID_TRANSITION", "Impossible d'affecter un utilisateur à un département désactivé.");
    }
  }

  async createUser(principal: DepartmentPrincipal, body: UserInput, key: string, trace: string): Promise<AdminUser> {
    object(body, ["subject", "displayName", "email", "photoUrl", "superAdmin", "memberships"], ["subject", "displayName", "memberships"]);
    subject(body.subject); text(body.displayName, 200, "displayName"); contact(body); if (body.superAdmin !== undefined) boolean(body.superAdmin);
    const assigned = memberships(body.memberships);
    if (!body.superAdmin && !assigned.some(m => m.active)) invalid("Une affectation active est requise.");
    return this.write(principal, ["users", "POST"], body, key, trace, async (client, actor) => {
      assertDepartmentPermission(actor, "users:manage");
      if (!actor.superAdmin && body.superAdmin) throw new Problem(403, "FORBIDDEN", "Seul le super administrateur attribue les droits globaux.");
      await this.checkMemberships(client, actor, assigned);
      await client.query("INSERT INTO backend_admin_users(subject,display_name,email,photo_url,super_admin) VALUES($1,$2,$3,$4,$5)", [body.subject, body.displayName, body.email ?? null, body.photoUrl ?? null, body.superAdmin === true]);
      for (const item of assigned) await client.query("INSERT INTO backend_admin_memberships(subject,department_id,role,active) VALUES($1,$2,$3,$4)", [body.subject, item.departmentId, item.role, item.active]);
      await this.audit(client, actor, "user.created", body.subject, assigned.map(m => m.departmentId), trace);
      return this.visible(actor, await this.user(client, body.subject));
    });
  }

  private async protectSuperAdmin(client: PoolClient, saved: AdminUser, active: boolean, superAdmin: boolean): Promise<void> {
    if (saved.active && saved.superAdmin && (!active || !superAdmin)) {
      const count = Number((await client.query("SELECT count(*) FROM backend_admin_users WHERE active AND super_admin AND subject<>$1", [saved.subject])).rows[0].count);
      if (!count) throw new Problem(409, "INVALID_TRANSITION", "Le dernier super administrateur actif doit être conservé.");
    }
  }

  async updateUser(principal: DepartmentPrincipal, id: string, body: UserUpdate, key: string, trace: string): Promise<AdminUser> {
    subject(id); object(body, ["revision", "displayName", "email", "photoUrl", "active", "superAdmin", "memberships"], ["revision"]); revision(body.revision);
    if (Object.keys(body).length < 2) invalid("Aucune modification fournie.");
    if (body.displayName !== undefined) text(body.displayName, 200, "displayName"); contact(body);
    if (body.active !== undefined) boolean(body.active); if (body.superAdmin !== undefined) boolean(body.superAdmin);
    const assigned = body.memberships === undefined ? undefined : memberships(body.memberships);
    return this.write(principal, ["users", id, "PUT"], body, key, trace, async (client, actor) => {
      assertDepartmentPermission(actor, "users:manage");
      const saved = await this.user(client, id); this.visible(actor, saved);
      if (saved.revision !== body.revision) throw new Problem(409, "VERSION_CONFLICT", "L'utilisateur a été modifié; rechargez-le.");
      const ids = managed(actor);
      if (!actor.superAdmin) {
        if (body.active !== undefined || body.superAdmin !== undefined || saved.superAdmin) throw new Problem(403, "FORBIDDEN", "Les droits globaux et comptes super administrateurs sont réservés au super administrateur.");
        const shared = saved.memberships.some(m => !ids.includes(m.departmentId));
        if (shared && ["displayName", "email", "photoUrl"].some(k => k in body)) throw new Problem(403, "FORBIDDEN", "Le profil partagé se modifie par son titulaire ou par un super administrateur.");
      }
      if (assigned) await this.checkMemberships(client, actor, assigned);
      await this.protectSuperAdmin(client, saved, body.active ?? saved.active, body.superAdmin ?? saved.superAdmin);
      await client.query("UPDATE backend_admin_users SET display_name=$2,email=$3,photo_url=$4,active=$5,super_admin=$6,revision=revision+1,updated_at=now() WHERE subject=$1", [id, body.displayName ?? saved.displayName, body.email === undefined ? saved.email ?? null : body.email, body.photoUrl === undefined ? saved.photoUrl ?? null : body.photoUrl, body.active ?? saved.active, body.superAdmin ?? saved.superAdmin]);
      if (assigned) {
        await client.query("UPDATE backend_admin_memberships SET active=false WHERE subject=$1 AND ($2::boolean OR department_id=ANY($3::text[]))", [id, actor.superAdmin, ids]);
        for (const item of assigned) await client.query("INSERT INTO backend_admin_memberships(subject,department_id,role,active) VALUES($1,$2,$3,$4) ON CONFLICT(subject,department_id) DO UPDATE SET role=excluded.role,active=excluded.active", [id, item.departmentId, item.role, item.active]);
      }
      await this.audit(client, actor, "user.updated", id, actor.superAdmin ? (assigned ?? saved.memberships).map(m => m.departmentId) : ids, trace);
      return this.visible(actor, await this.user(client, id));
    });
  }

  async deactivateUser(principal: DepartmentPrincipal, id: string, key: string, trace: string): Promise<null> {
    subject(id);
    return this.write(principal, ["users", id, "DELETE"], null, key, trace, async (client, actor) => {
      assertDepartmentPermission(actor, "users:manage");
      const saved = await this.user(client, id); this.visible(actor, saved);
      if (!actor.superAdmin && saved.superAdmin) throw new Problem(403, "FORBIDDEN", "Compte super administrateur protégé.");
      if (actor.superAdmin) {
        await this.protectSuperAdmin(client, saved, false, saved.superAdmin);
        await client.query("UPDATE backend_admin_users SET active=false,revision=revision+1,updated_at=now() WHERE subject=$1", [id]);
      } else {
        await client.query("UPDATE backend_admin_memberships SET active=false WHERE subject=$1 AND department_id=ANY($2::text[])", [id, managed(actor)]);
        await client.query("UPDATE backend_admin_users SET revision=revision+1,updated_at=now() WHERE subject=$1", [id]);
      }
      await this.audit(client, actor, "user.deactivated", id, actor.superAdmin ? saved.memberships.map(m => m.departmentId) : managed(actor), trace);
      return null;
    });
  }
}
