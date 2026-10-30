import type { Pool } from "pg";

export type DirectorySeedDepartment = { id: string; name: string; code?: string; active?: boolean };
export type DirectorySeedMembership = { departmentId: string; role: "agent" | "admin"; active?: boolean };
export type DirectorySeedUser = {
  subject: string;
  displayName: string;
  email?: string;
  photoUrl?: string;
  superAdmin?: boolean;
  memberships: DirectorySeedMembership[];
};
export type DirectorySeed = { departments?: DirectorySeedDepartment[]; users?: DirectorySeedUser[] };

function invalid(detail: string): never {
  throw new Error(detail);
}

function departmentId(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(value)) invalid("Identifiant de département invalide.");
}

function text(value: unknown, max: number, field: string): asserts value is string {
  if (typeof value !== "string" || !value.trim() || value !== value.trim() || value.length > max) invalid(`${field} invalide.`);
}

export function parseDirectorySeed(value: unknown): DirectorySeed {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("Fichier de seed annuaire invalide.");
  const body = value as Record<string, unknown>;
  if (body.departments !== undefined && !Array.isArray(body.departments)) invalid("departments doit être un tableau.");
  if (body.users !== undefined && !Array.isArray(body.users)) invalid("users doit être un tableau.");
  const departments = ((body.departments ?? []) as unknown[]).map(item => {
    if (!item || typeof item !== "object" || Array.isArray(item)) invalid("Département invalide.");
    const department = item as Record<string, unknown>;
    departmentId(department.id);
    text(department.name, 200, "name");
    if (department.code !== undefined) text(department.code, 50, "code");
    if (department.active !== undefined && typeof department.active !== "boolean") invalid("active invalide.");
    return { id: department.id, name: department.name, code: department.code, active: department.active !== false };
  });
  const known = new Set(departments.map(department => department.id));
  const users = ((body.users ?? []) as unknown[]).map(item => {
    if (!item || typeof item !== "object" || Array.isArray(item)) invalid("Utilisateur invalide.");
    const user = item as Record<string, unknown>;
    text(user.subject, 255, "subject");
    text(user.displayName, 200, "displayName");
    if (user.superAdmin !== undefined && typeof user.superAdmin !== "boolean") invalid("superAdmin invalide.");
    if (!Array.isArray(user.memberships) || user.memberships.length > 100) invalid("Affectations invalides.");
    const seen = new Set<string>();
    const memberships = user.memberships.map(entry => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) invalid("Affectation invalide.");
      const membership = entry as Record<string, unknown>;
      departmentId(membership.departmentId);
      if (!["agent", "admin"].includes(membership.role as string) || seen.has(membership.departmentId)) invalid("Affectation dupliquée ou rôle invalide.");
      seen.add(membership.departmentId);
      if (membership.active !== undefined && typeof membership.active !== "boolean") invalid("active invalide.");
      return { departmentId: membership.departmentId, role: membership.role as "agent" | "admin", active: membership.active !== false };
    });
    if (!user.superAdmin && !memberships.some(membership => membership.active)) invalid("Une affectation active est requise.");
    return {
      subject: user.subject,
      displayName: user.displayName,
      email: typeof user.email === "string" ? user.email : undefined,
      photoUrl: typeof user.photoUrl === "string" ? user.photoUrl : undefined,
      superAdmin: user.superAdmin === true,
      memberships,
    };
  });
  for (const user of users) {
    for (const membership of user.memberships) {
      if (!known.has(membership.departmentId)) invalid(`Affectation vers un département absent du seed: ${membership.departmentId}.`);
    }
  }
  return { departments, users };
}

/** Inserts missing departments and users only. Existing rows keep their current assignments. */
export async function seedDirectory(pool: Pool, value: unknown): Promise<{ departments: number; users: number }> {
  const seed = parseDirectorySeed(value);
  let departments = 0, users = 0;
  for (const department of seed.departments ?? []) {
    const result = await pool.query(
      "INSERT INTO backend_departments(id,name,code,active) VALUES($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING",
      [department.id, department.name, department.code ?? null, department.active !== false],
    );
    departments += result.rowCount ?? 0;
  }
  for (const user of seed.users ?? []) {
    const result = await pool.query(
      "INSERT INTO backend_admin_users(subject,display_name,email,photo_url,super_admin) VALUES($1,$2,$3,$4,$5) ON CONFLICT (subject) DO NOTHING",
      [user.subject, user.displayName, user.email ?? null, user.photoUrl ?? null, user.superAdmin === true],
    );
    users += result.rowCount ?? 0;
    for (const membership of user.memberships) {
      await pool.query(
        "INSERT INTO backend_admin_memberships(subject,department_id,role,active) VALUES($1,$2,$3,$4) ON CONFLICT (subject,department_id) DO NOTHING",
        [user.subject, membership.departmentId, membership.role, membership.active !== false],
      );
    }
  }
  return { departments, users };
}
