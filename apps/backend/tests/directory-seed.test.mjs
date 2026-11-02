import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { database, migrate } from "../dist/apps/backend/src/database.js";
import { parseDirectorySeed, seedDirectory } from "../dist/apps/backend/src/directory-seed.js";
import { isolatedDatabase } from "./helpers.mjs";

const fixture = JSON.parse(readFileSync(fileURLToPath(new URL("../seeds/demo-deux-bureaux.json", import.meta.url)), "utf8"));

test("demo directory seed inserts justice, enseignement and anip once", async t => {
  const pg = await isolatedDatabase(), pool = database(pg.connection);
  t.after(async () => { await pool.end(); await pg.close(); });
  await migrate(pool);

  const parsed = parseDirectorySeed(fixture);
  assert.deepEqual(parsed.departments.map(d => d.id), ["justice", "enseignement", "anip"]);
  assert.deepEqual(parsed.users.map(u => u.subject), ["justice-agent", "enseignement-agent", "anip-agent", "demo-super-admin"]);

  const first = await seedDirectory(pool, fixture);
  assert.equal(first.departments, 3);
  assert.equal(first.users, 4);
  const second = await seedDirectory(pool, fixture);
  assert.equal(second.departments, 0);
  assert.equal(second.users, 0);

  const departments = (await pool.query("SELECT id FROM backend_departments ORDER BY id")).rows.map(row => row.id);
  assert.deepEqual(departments, ["anip", "enseignement", "justice"]);
  const memberships = (await pool.query("SELECT subject,department_id,role FROM backend_admin_memberships ORDER BY subject")).rows;
  assert.deepEqual(memberships, [
    { subject: "anip-agent", department_id: "anip", role: "agent" },
    { subject: "enseignement-agent", department_id: "enseignement", role: "agent" },
    { subject: "justice-agent", department_id: "justice", role: "agent" },
  ]);
  const superAdmin = (await pool.query("SELECT super_admin FROM backend_admin_users WHERE subject='demo-super-admin'")).rows[0];
  assert.equal(superAdmin.super_admin, true);

  assert.throws(() => parseDirectorySeed({ departments: [{ id: "justice", name: "Justice" }], users: [{ subject: "x", displayName: "X", memberships: [{ departmentId: "sante", role: "agent" }] }] }), /absent du seed/);
});
