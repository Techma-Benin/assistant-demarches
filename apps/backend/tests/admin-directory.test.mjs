import { test } from "node:test";
import assert from "node:assert/strict";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { createBackend } from "../dist/apps/backend/src/app.js";
import { database, migrate } from "../dist/apps/backend/src/database.js";
import { requireDepartmentPrincipal } from "../dist/apps/backend/src/department-auth.js";
import { isolatedDatabase } from "./helpers.mjs";

test("administrative directory: signed identity, department isolation, concurrency and immediate revocation", async t => {
  const pg = await isolatedDatabase(), pool = database(pg.connection);
  t.after(async () => { await pool.end(); await pg.close(); });
  await migrate(pool);
  await migrate(pool);
  const { privateKey, publicKey } = await generateKeyPair("RS256"), kid = "directory-test";
  const issuer = "https://identity.example.test/directory";
  const auth = { issuer, audience: "techma-backend", key: createLocalJWKSet({ keys: [{ ...await exportJWK(publicKey), kid, alg: "RS256" }] }) };
  const token = (subject, claims = {}) => new SignJWT(claims).setProtectedHeader({ alg: "RS256", kid }).setIssuer(issuer).setAudience(auth.audience).setSubject(subject).setIssuedAt().setExpirationTime("5m").sign(privateKey);
  const root = await token("root", { scope: "admin:super" });
  const app = await createBackend({ pool, auth, allowedMcpUrls: new Set() });
  t.after(() => app.close());
  await app.listen(0, "127.0.0.1");
  const url = await app.getUrl(), traceparent = "00-" + "3".repeat(32) + "-" + "4".repeat(16) + "-01";
  let sequence = 0;
  async function request(path, options = {}) {
    const { method = "GET", body, bearer = root, key = "directory-key-" + ++sequence, headers = {} } = options;
    const response = await fetch(url + "/v1/admin" + path, { method, headers: { ...(bearer ? { Authorization: "Bearer " + bearer } : {}), traceparent, "Idempotency-Key": key, ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...headers }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, value: response.status === 204 ? null : await response.json() };
  }
  const addUser = (subject, memberships, extra = {}) => request("/users", { method: "POST", body: { subject, displayName: subject, memberships, ...extra } });
  const m = (departmentId, role = "agent", active = true) => ({ departmentId, role, active });
  const principal = async bearer => requireDepartmentPrincipal({ get: name => name === "authorization" ? "Bearer " + bearer : undefined }, auth, pool);

  await t.test("department writes require super admin, validate input, and replay concurrent requests once", async () => {
    assert.equal((await request("/me", { bearer: null })).status, 401);
    const results = await Promise.all(Array.from({ length: 3 }, () => request("/departments", { method: "POST", body: { id: "alpha", name: "Ministère Alpha" }, key: "create-alpha" })));
    for (const result of results) { assert.equal(result.status, 201, JSON.stringify(result.value)); assert.deepEqual(result.value, results[0].value); }
    assert.equal(Number((await pool.query("SELECT count(*) FROM backend_admin_directory_audit WHERE target='alpha'")).rows[0].count), 1);
    assert.equal((await request("/departments", { method: "POST", body: { id: "alpha", name: "Autre" }, key: "create-alpha" })).status, 409);
    assert.equal((await request("/departments", { method: "POST", body: { id: "beta", name: "Ministère Beta" } })).status, 201);
    assert.equal((await request("/departments", { method: "POST", body: { id: "bad", name: " ", unexpected: true } })).status, 400);
    assert.equal((await request("/departments", { method: "POST", body: { id: "bad/id", name: "Bad" } })).status, 400);
    assert.equal((await request("/departments", { method: "POST", body: { id: "gamma", name: "Gamma" }, key: "" })).status, 400);
    assert.equal((await request("/departments", { headers: { traceparent: "bad" } })).status, 400);
    assert.equal((await addUser("root", [], { superAdmin: true })).status, 201);
    for (const [subject, memberships] of [["admin-alpha", [m("alpha", "admin")]], ["admin-beta", [m("beta", "admin")]], ["mixed", [m("alpha", "admin"), m("beta")]], ["agent-alpha", [m("alpha")]], ["shared", [m("alpha"), m("beta")]]]) {
      const result = await addUser(subject, memberships);
      assert.equal(result.status, 201, JSON.stringify(result.value));
    }
  });

  const adminAlpha = await token("admin-alpha", { administrationId: "beta", scope: "admin:super admin:read admin:write" });
  const adminBeta = await token("admin-beta"), mixed = await token("mixed"), agentAlpha = await token("agent-alpha"), shared = await token("shared");
  await t.test("business super admins cannot bypass operator grants, with or without directory enrollment", async () => {
    const headers = { "X-Administration-Id": "alpha" };
    const model = { id: "operator-test", provider: "openai-compatible", model: "synthetic-model", promptVersion: "agent-v1", temperature: 0.2, active: true };
    const assertDenied = async bearer => {
      assert.equal((await request("/models", { bearer, headers })).status, 403);
      assert.equal((await request("/models", { bearer, headers, method: "POST", body: model })).status, 403);
    };
    await assertDenied(root);
    const unenrolled = await token("unenrolled-business-super", { scope: "admin:super" });
    await assertDenied(unenrolled);
    for (const permission of ["operator:read", "operator:write"]) {
      await assert.rejects(() => requireDepartmentPrincipal({ get: () => "Bearer " + unenrolled }, auth, pool, permission, "alpha"), { status: 403 });
    }
    const dedicated = await token("root", { scope: "admin:super operator:read operator:write" });
    await assertDenied(dedicated);
    await pool.query("UPDATE backend_admin_users SET operator_permissions=ARRAY['operator:read','operator:write'] WHERE subject='root'");
    try {
      await assertDenied(root);
      await assertDenied(await token("root", { scope: "admin:super admin:read admin:write" }));
      assert.equal((await request("/models", { bearer: dedicated, headers })).status, 200);
      assert.equal((await request("/models", { bearer: dedicated, headers, method: "POST", body: model })).status, 201);
      const readOnly = await token("root", { scope: "admin:super operator:read" });
      assert.equal((await request("/models", { bearer: readOnly, headers })).status, 200);
      assert.equal((await request("/models", { bearer: readOnly, headers, method: "POST", body: { ...model, id: "operator-readonly" } })).status, 403);
      const writeOnly = await token("root", { scope: "admin:super operator:write" });
      assert.equal((await request("/models", { bearer: writeOnly, headers })).status, 403);
      assert.equal((await request("/models", { bearer: writeOnly, headers, method: "POST", body: { ...model, id: "operator-writeonly" } })).status, 201);
    } finally {
      await pool.query("UPDATE backend_admin_users SET operator_permissions='{}' WHERE subject='root'");
    }
    await assertDenied(dedicated);
  });
  await t.test("registered assignments override signed legacy claims and enforce per-department roles", async () => {
    const me = await request("/me", { bearer: adminAlpha });
    assert.equal(me.status, 200); assert.equal(me.value.superAdmin, false); assert.deepEqual(me.value.departmentIds, ["alpha"]);
    assert.ok(me.value.permissions.includes("dept:write"));
    assert.ok(!me.value.permissions.includes("operator:write"));
    assert.equal(me.value.identityProvider, "oidc"); assert.equal(me.value.directorySource, "backend-demo-adapter");
    assert.equal((await request("/departments", { bearer: adminAlpha, method: "POST", body: { id: "gamma", name: "Gamma" } })).status, 403);
    assert.deepEqual((await request("/departments", { bearer: agentAlpha })).value.items.map(d => d.id), ["alpha"]);
    assert.equal((await request("/users", { bearer: agentAlpha })).status, 403);
    assert.equal((await request("/users?departmentId=beta", { bearer: adminAlpha })).status, 403);
    assert.equal((await request("/users?departmentId=beta", { bearer: mixed })).status, 403);
    const current = await principal(mixed);
    assert.equal(current.departmentRoles.alpha, "admin"); assert.equal(current.departmentRoles.beta, "agent");
    await assert.rejects(() => requireDepartmentPrincipal({ get: () => "Bearer " + mixed }, auth, pool, "users:manage", "beta"), { status: 403 });
    const local = await request("/users", { bearer: adminAlpha });
    assert.ok(local.value.items.every(u => u.memberships.every(m => m.departmentId === "alpha")));
    assert.ok(!local.value.items.some(u => u.subject === "admin-beta"));
    const forged = await request("/users", { bearer: adminAlpha, method: "POST", body: { subject: "forged", displayName: "Forged", superAdmin: true, memberships: [m("alpha")] } });
    assert.equal(forged.status, 403);
    assert.equal((await request("/users", { bearer: adminAlpha, method: "POST", body: { subject: "cross", displayName: "Cross", memberships: [m("beta")] } })).status, 403);
    assert.equal((await request("/users/admin-beta", { bearer: adminAlpha, method: "PUT", body: { revision: 1, displayName: "Cross" } })).status, 404);
    assert.equal((await request("/users/shared", { bearer: adminAlpha, method: "PUT", body: { revision: 1, displayName: "Global shared change" } })).status, 403);
    const changed = await request("/users/shared", { bearer: adminAlpha, method: "PUT", body: { revision: 1, memberships: [m("alpha", "agent", false)] } });
    assert.equal(changed.status, 200); assert.deepEqual(changed.value.memberships, [m("alpha", "agent", false)]);
    assert.deepEqual((await request("/me", { bearer: shared })).value.departmentIds, ["beta"]);
    const betaShared = (await request("/users", { bearer: adminBeta })).value.items.find(u => u.subject === "shared");
    assert.deepEqual(betaShared.memberships, [m("beta")]);
  });

  await t.test("profile changes are revision protected, strictly validated, idempotent and cannot grant rights", async () => {
    const profile = (await request("/me", { bearer: agentAlpha })).value;
    const body = { revision: profile.revision, displayName: "Agent Alpha", email: "agent@example.test", photoUrl: "https://cdn.example.test/avatar.png" };
    const results = await Promise.all(Array.from({ length: 3 }, () => request("/me", { bearer: agentAlpha, method: "PUT", body, key: "profile-concurrent" })));
    for (const result of results) { assert.equal(result.status, 200); assert.equal(result.value.revision, 2); assert.equal(result.value.displayName, "Agent Alpha"); }
    assert.equal(Number((await pool.query("SELECT count(*) FROM backend_admin_directory_audit WHERE actor_subject='agent-alpha' AND action='profile.updated'")).rows[0].count), 1);
    assert.equal((await request("/me", { bearer: agentAlpha, method: "PUT", body })).status, 409);
    assert.equal((await request("/me", { bearer: agentAlpha, method: "PUT", body: { ...body, revision: 2, superAdmin: true } })).status, 400);
    assert.equal((await request("/me", { bearer: agentAlpha, method: "PUT", body: { ...body, revision: 2, photoUrl: "javascript:alert(1)" } })).status, 400);
    assert.equal((await request("/me", { bearer: agentAlpha, method: "PUT", body: { ...body, revision: 2, photoUrl: "https://user:secret@example.test/a" } })).status, 400);
    const legacy = await token("legacy-reader", { administrationId: "alpha", scope: "admin:read" });
    const legacyProfile = await request("/me", { bearer: legacy });
    assert.equal(legacyProfile.value.revision, 0); assert.ok(!legacyProfile.value.permissions.includes("operator:write"));
    assert.equal((await request("/me", { bearer: legacy, method: "PUT", body: { revision: 1, displayName: "Reader" } })).status, 409);
    assert.equal((await request("/me", { bearer: await token("public-user") })).status, 403);
    const operator = await token("technical-operator", { scope: "operator:read" });
    const operatorMe = await request("/me", { bearer: operator });
    assert.equal(operatorMe.status, 200); assert.deepEqual(operatorMe.value.departmentIds, []);
    assert.deepEqual(operatorMe.value.permissions, ["operator:read"]);
    // A dedicated signed claim alone is insufficient after directory enrollment.
    const enrolledToken = await token("agent-alpha", { scope: "operator:read operator:write" });
    assert.ok(!(await principal(enrolledToken)).permissions.has("operator:read"));
    await pool.query("UPDATE backend_admin_users SET operator_permissions=ARRAY['operator:read'] WHERE subject='agent-alpha'");
    const enrolled = await principal(enrolledToken);
    assert.ok(enrolled.permissions.has("operator:read")); assert.ok(!enrolled.permissions.has("operator:write"));
    assert.ok(!(await principal(agentAlpha)).permissions.has("operator:read"));
    await pool.query("UPDATE backend_admin_users SET operator_permissions='{}' WHERE subject='agent-alpha'");
  });

  await t.test("idempotency never replays a former global view after an administrator is demoted", async () => {
    assert.equal((await addUser("temporary-super", [m("alpha", "admin")], { superAdmin: true })).status, 201);
    const formerSuper = await token("temporary-super", { scope: "admin:super" });
    const body = { subject: "cached-shared", displayName: "Cached shared", memberships: [m("alpha"), m("beta")] };
    const created = await request("/users", { bearer: formerSuper, method: "POST", body, key: "former-super-cache" });
    assert.equal(created.status, 201); assert.equal(created.value.memberships.length, 2);
    assert.equal((await request("/users/temporary-super", { method: "PUT", body: { revision: 1, superAdmin: false } })).status, 200);
    const replay = await request("/users", { bearer: formerSuper, method: "POST", body, key: "former-super-cache" });
    assert.equal(replay.status, 403);
    assert.equal((await request("/me", { bearer: formerSuper })).value.superAdmin, false);
  });

  await t.test("pagination is bounded and concurrent distinct edits cannot silently overwrite", async () => {
    const first = await request("/departments?limit=1"); assert.equal(first.status, 200); assert.equal(first.value.items.length, 1); assert.ok(first.value.nextCursor);
    const second = await request("/departments?limit=1&cursor=" + first.value.nextCursor); assert.equal(second.status, 200); assert.notEqual(second.value.items[0].id, first.value.items[0].id);
    assert.equal((await request("/users?cursor=" + first.value.nextCursor)).status, 400);
    for (const query of ["limit=0", "limit=101", "limit=no", "unknown=true", "cursor=bad"]) assert.equal((await request("/departments?" + query)).status, 400);
    const edits = await Promise.all(["One", "Two"].map(name => request("/departments/alpha", { method: "PUT", body: { name, active: true, revision: 1 } })));
    assert.deepEqual(edits.map(r => r.status).sort(), [200, 409]);
    assert.equal((await request("/departments/missing", { method: "PUT", body: { name: "Missing", active: true, revision: 1 } })).status, 404);
    const duplicate = await addUser("agent-alpha", [m("alpha")]); assert.equal(duplicate.status, 409);
    assert.equal((await request("/users/new", { method: "PUT", body: { revision: 1, active: false } })).status, 404);
    const invalid = await addUser("duplicate-membership", [m("alpha"), m("alpha")]); assert.equal(invalid.status, 400);
  });

  await t.test("logical deactivation revokes live JWT access, preserves other departments and protects last super admin", async () => {
    const localDelete = await request("/users/mixed", { method: "DELETE", bearer: adminAlpha });
    assert.equal(localDelete.status, 204);
    const mixedProfile = await request("/me", { bearer: mixed }); assert.equal(mixedProfile.status, 200); assert.deepEqual(mixedProfile.value.departmentIds, ["beta"]);
    assert.equal((await request("/users", { bearer: mixed })).status, 403);
    const deleted = await request("/users/shared", { method: "DELETE", key: "disable-shared" }); assert.equal(deleted.status, 204);
    assert.equal((await request("/users/shared", { method: "DELETE", key: "disable-shared" })).status, 204);
    assert.equal((await request("/me", { bearer: shared })).status, 403);
    await assert.rejects(() => principal(shared), { status: 403 });
    assert.equal((await request("/users/root", { method: "DELETE" })).status, 409);
    assert.equal((await request("/users/root", { method: "PUT", body: { revision: 1, superAdmin: false } })).status, 409);
    const before = Number((await pool.query("SELECT count(*) FROM backend_admin_directory_audit")).rows[0].count);
    assert.equal((await request("/users/agent-alpha", { method: "DELETE", bearer: adminAlpha, body: {} })).status, 400);
    assert.equal(Number((await pool.query("SELECT count(*) FROM backend_admin_directory_audit")).rows[0].count), before);
    const audit = (await pool.query("SELECT * FROM backend_admin_directory_audit ORDER BY created_at")).rows;
    assert.ok(audit.every(row => row.traceparent === traceparent));
    assert.ok(audit.every(row => !("email" in row) && !("display_name" in row)));
  });
});
