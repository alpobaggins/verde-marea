import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { test } from "node:test";
import { compare, getRounds } from "bcryptjs";
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
