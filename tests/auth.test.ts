import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { test } from "node:test";
import { compare, getRounds } from "bcryptjs";
import { canAccessAdministration, canChangeAccountRole } from "../lib/auth/permissions";
import type { Role } from "../prisma/generated/client/enums";
import { findSessionUser, loginUser, registerUser, revokeSession } from "../lib/auth/service";
import { credentialsSchema, registrationSchema } from "../lib/auth/validation";
import { getPrisma } from "../lib/db";

test("validation normalizes email, strips role and enforces bcrypt's byte limit", () => {
  const input = { email: "  USER@verde-marea.test ", password: " pass ", name: " User " };

  assert.deepEqual(registrationSchema.parse({ ...input, role: "super_admin" }), {
    email: "user@verde-marea.test",
    password: " pass ",
    name: "User",
  });
  assert.equal(registrationSchema.safeParse({ ...input, name: " " }).success, false);
  assert.equal(credentialsSchema.safeParse({ ...input, email: "invalid" }).success, false);
  assert.equal(credentialsSchema.safeParse({ ...input, password: "я".repeat(36) }).success, true);
  assert.equal(credentialsSchema.safeParse({ ...input, password: "я".repeat(37) }).success, false);
});

test("missing and malformed tokens have no session", async () => {
  assert.equal(await findSessionUser(undefined), null);
  assert.equal(await findSessionUser("invalid"), null);
});

test("administration and role changes follow the role matrix", () => {
  const roles = ["user", "admin", "super_admin"] as const;
  for (const actorRole of roles) {
    const actor = { id: "actor", role: actorRole };
    assert.equal(canAccessAdministration(actorRole), actorRole !== "user");

    for (const targetRole of roles) {
      for (const newRole of roles) {
        const target = { id: "target", role: targetRole };
        const permitted = actorRole === "super_admin" && [
          "user:admin",
          "admin:user",
        ].includes(`${targetRole}:${newRole}`);
        assert.equal(canChangeAccountRole(actor, target, newRole), permitted);
        assert.equal(canChangeAccountRole(actor, actor, newRole), false);
      }
    }
  }
});

const testDatabaseUrl = process.env.AUTH_TEST_DATABASE_URL;

test("PostgreSQL registration, credentials and session lifecycle", {
  skip: testDatabaseUrl ? false : "Set AUTH_TEST_DATABASE_URL to a migrated test database.",
}, async () => {
  process.env.DATABASE_URL = testDatabaseUrl!;
  const prisma = getPrisma();
  const email = `auth-test-${randomUUID()}@verde-marea.test`;
  const credentials = { email, password: "auth test passphrase" };

  try {
    const registration = registrationSchema.parse({
      ...credentials, name: "Auth test", role: "admin",
    });
    const results = await Promise.all([registerUser(registration), registerUser(registration)]);
    assert.deepEqual(results.sort(), [false, true]);

    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    assert.equal(user.role, "user");
    assert.notEqual(user.passwordHash, credentials.password);
    assert.equal(getRounds(user.passwordHash), 12);
    assert.equal(await compare(credentials.password, user.passwordHash), true);

    assert.equal(await loginUser({ ...credentials, password: "incorrect" }), null);
    assert.equal(await loginUser({ ...credentials, email: `unknown-${email}` }), null);
    assert.equal(await prisma.session.count({ where: { userId: user.id } }), 0);

    const beforeLogin = Date.now();
    const active = await loginUser(credentials);
    const other = await loginUser(credentials);
    assert.ok(active && other);
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    assert.ok(active.expiresAt.getTime() >= beforeLogin + sevenDays);
    assert.ok(active.expiresAt.getTime() <= Date.now() + sevenDays);

    const tokenHash = createHash("sha256").update(active.token).digest("hex");
    const stored = await prisma.session.findUniqueOrThrow({ where: { tokenHash } });
    assert.equal(stored.userId, user.id);
    assert.deepEqual(stored.expiresAt, active.expiresAt);
    assert.equal(await prisma.session.count({ where: { tokenHash: active.token } }), 0);
    assert.deepEqual(await findSessionUser(active.token), { id: user.id, email, role: "user" });

    await revokeSession(active.token);
    await revokeSession(active.token);
    assert.equal(await findSessionUser(active.token), null);
    assert.equal((await findSessionUser(other.token))?.id, user.id);

    await prisma.session.updateMany({ where: { userId: user.id }, data: { expiresAt: new Date(0) } });
    assert.equal(await findSessionUser(other.token), null);
  } finally {
    try {
      await prisma.user.deleteMany({ where: { email } });
    } finally {
      await prisma.$disconnect();
    }
  }
});

const appUrl = process.env.AUTH_TEST_APP_URL;

test("HTTP account and administration checks use the same live session", {
  skip: appUrl && testDatabaseUrl ? false : "Set AUTH_TEST_APP_URL and AUTH_TEST_DATABASE_URL.",
}, async () => {
  process.env.DATABASE_URL = testDatabaseUrl!;
  const prisma = getPrisma();
  const email = `access-test-${randomUUID()}@verde-marea.test`;
  const credentials = { email, password: "auth test passphrase" };

  function request(path: string, token?: string) {
    // Send both cookie names so the same suite can run against dev or production.
    const headers: HeadersInit = token ? {
      Cookie: `verde_session=${token}; __Host-verde_session=${token}`,
    } : {};
    return fetch(new URL(path, appUrl), { headers, redirect: "manual" });
  }

  async function expectLoginRedirect(path: string, token?: string) {
    const response = await request(path, token);
    assert.equal(response.status, 307);
    assert.equal(response.headers.get("location"), "/login");
  }

  async function expectApiAccess(status: number, token?: string, role?: Role) {
    const response = await request("/api/admin/access?role=super_admin", token);
    assert.equal(response.status, status);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    const body = await response.json();
    if (role) assert.deepEqual(body, { role });
    else assert.deepEqual(Object.keys(body), ["error"]);
  }

  try {
    await expectLoginRedirect("/account");
    await expectLoginRedirect("/admin");
    await expectApiAccess(401);

    const registration = registrationSchema.parse({
      ...credentials, name: "Access test", role: "super_admin",
    });
    assert.equal(await registerUser(registration), true);
    const session = await loginUser(credentials);
    assert.ok(session);
    const account = await request("/account", session.token);
    assert.equal(account.status, 200);
    assert.ok((await account.text()).includes(email));

    const userAdminPage = await request("/admin?role=super_admin", session.token);
    const deniedPage = await userAdminPage.text();
    assert.match(deniedPage, /Доступ запрещён/);
    assert.doesNotMatch(deniedPage, /Ваша роль/);
    await expectApiAccess(403, session.token);

    for (const role of ["admin", "super_admin"] as const) {
      await prisma.user.update({ where: { email }, data: { role } });
      const adminPage = await request("/admin", session.token);
      assert.equal(adminPage.status, 200);
      const body = await adminPage.text();
      assert.match(body, /Администрирование/);
      assert.ok(body.includes(role));
      await expectApiAccess(200, session.token, role);
    }

    await prisma.user.update({ where: { email }, data: { role: "user" } });
    await expectApiAccess(403, session.token);
    const demotedPage = await request("/admin", session.token);
    assert.match(await demotedPage.text(), /Доступ запрещён/);

    await prisma.user.update({ where: { email }, data: { role: "admin" } });
    await prisma.session.update({
      where: { tokenHash: createHash("sha256").update(session.token).digest("hex") },
      data: { expiresAt: new Date(0) },
    });
    const revoked = await loginUser(credentials);
    assert.ok(revoked);
    await revokeSession(revoked.token);

    for (const { token } of [session, revoked]) {
      await expectLoginRedirect("/account", token);
      await expectLoginRedirect("/admin", token);
      await expectApiAccess(401, token);
    }
  } finally {
    try {
      await prisma.user.deleteMany({ where: { email } });
    } finally {
      await prisma.$disconnect();
    }
  }
});
