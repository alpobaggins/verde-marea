import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { getPrisma } from "../lib/db";
import type { Role } from "../prisma/generated/client/enums";

const dbUrl = process.env.ADMIN_IDENTITY_TEST_DATABASE_URL;
const appUrl = process.env.ADMIN_IDENTITY_TEST_APP_URL;
const users = "/api/admin/users";
const audit = "/api/admin/audit";
const fixtureSecret = "synthetic-fixture-secret";

test("administrative identities and audit HTTP API on PostgreSQL", {
  skip: dbUrl && appUrl ? false : "Set ADMIN_IDENTITY_TEST_DATABASE_URL and ADMIN_IDENTITY_TEST_APP_URL.",
}, async (t) => {
  assert.equal(new URL(dbUrl!).pathname, "/verde_marea_admin_identity_test");
  process.env.DATABASE_URL = dbUrl;
  const prisma = getPrisma();
  assert.equal(await prisma.user.count(), 0);
  assert.equal(await prisma.auditLog.count(), 0);
  t.after(async () => {
    await prisma.auditLog.deleteMany();
    await prisma.user.deleteMany();
    await prisma.$disconnect();
  });

  async function account(name: string, role: Role) {
    const token = randomBytes(32).toString("hex");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const user = await prisma.user.create({
      data: { role, name, email: `${name}@identity.test`, passwordHash: fixtureSecret },
      select: { id: true, role: true, name: true, email: true },
    });
    await prisma.session.create({ data: {
      userId: user.id, tokenHash, expiresAt: new Date(Date.now() + 3_600_000),
    } });
    return { user, token, tokenHash };
  }

  const [owner, admin, manager, otherManager] = await Promise.all([
    account("owner", "user"), account("admin", "admin"),
    account("manager", "super_admin"), account("other-manager", "super_admin"),
  ]);

  function request(path: string, token?: string, body?: object, method = body ? "PATCH" : "GET") {
    return fetch(new URL(path, appUrl), {
      method,
      headers: {
        ...(token ? { Cookie: `__Host-verde_session=${token}` } : {}),
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  const promote = { expectedRole: "user", expectedVersion: 0, role: "admin" };
  const demote = { expectedRole: "admin", expectedVersion: 1, role: "user" };
  const patch = (token: string | undefined, id = owner.user.id, body: object = promote) =>
    request(`${users}/${id}/role`, token, body);

  async function safeJson(response: Response) {
    const body = await response.text();
    for (const secret of [
      fixtureSecret, "passwordHash", "tokenHash", "expiresAt",
      ...[owner, admin, manager, otherManager].flatMap(({ token, tokenHash }) => [token, tokenHash]),
    ]) assert.equal(body.includes(secret), false);
    return JSON.parse(body);
  }

  await t.test("user and audit reads enforce roles and return only allowed account fields", async () => {
    for (const [token, status] of [[undefined, 401], [owner.token, 403]] as const) {
      for (const path of [users, audit]) {
        const response = await request(path, token);
        assert.equal(response.status, status);
        assert.equal(response.headers.get("cache-control"), "private, no-store");
        assert.deepEqual(Object.keys(await safeJson(response)), ["error"]);
      }
      assert.equal((await patch(token)).status, status);
    }
    assert.deepEqual(await safeJson(await request(users, admin.token)), { users: [owner.user] });
    assert.deepEqual(await safeJson(await request(users, manager.token)), {
      users: [admin.user, manager.user, otherManager.user, owner.user].map((user) => ({ ...user, roleVersion: 0 })),
    });
  });

  await t.test("only the permitted role transitions are accepted", async () => {
    assert.equal((await patch(admin.token)).status, 403);
    assert.equal((await patch(manager.token, manager.user.id, demote)).status, 403);
    assert.equal((await patch(manager.token, otherManager.user.id, demote)).status, 403);
    assert.equal((await patch(manager.token, owner.user.id, { ...promote, role: "super_admin" })).status, 400);
    assert.equal((await patch(manager.token, owner.user.id, { ...promote, actorId: owner.user.id })).status, 400);
    assert.equal((await patch(manager.token, randomUUID())).status, 404);
    assert.equal((await patch(manager.token, owner.user.id, demote)).status, 409);
    assert.equal(await prisma.auditLog.count(), 0);
  });

  await t.test("promotion and demotion apply immediately to the same session and audit exactly once each", async () => {
    const response = await patch(manager.token);
    assert.equal(response.status, 200);
    assert.deepEqual(await safeJson(response), { ...owner.user, role: "admin", roleVersion: 1 });
    assert.equal((await request(users, owner.token)).status, 200);
    assert.equal((await patch(manager.token)).status, 409);
    assert.equal((await patch(manager.token, owner.user.id, demote)).status, 200);
    assert.equal((await patch(manager.token)).status, 409);
    for (const path of [users, audit, "/api/admin/access", "/api/admin/bookings", "/api/admin/availability/tables"]) {
      assert.equal((await request(path, owner.token)).status, 403, path);
    }
    assert.equal((await request("/account", owner.token)).status, 200);
    assert.equal(await prisma.session.count({ where: { userId: owner.user.id } }), 1);
    const entries = await prisma.auditLog.findMany({ where: { targetId: owner.user.id } });
    assert.equal(entries.length, 2);
    for (const entry of entries) {
      assert.equal(entry.action, "user_role_changed");
      assert.equal(entry.actorId, manager.user.id);
      assert.equal(entry.actorRole, "super_admin");
      assert.equal(entry.targetType, "user");
    }
    assert.ok(entries.some(({ before, after }) =>
      JSON.stringify(before) === '{"role":"user"}' && JSON.stringify(after) === '{"role":"admin"}'));
    assert.ok(entries.some(({ before, after }) =>
      JSON.stringify(before) === '{"role":"admin"}' && JSON.stringify(after) === '{"role":"user"}'));
  });

  await t.test("a failed audit insert rolls back the role", async () => {
    await prisma.$executeRaw`ALTER TABLE "AuditLog" ADD CONSTRAINT test_reject_role_audit CHECK (false) NOT VALID`;
    try {
      const response = await patch(manager.token, owner.user.id, { ...promote, expectedVersion: 2 });
      assert.equal(response.status, 500);
      await safeJson(response);
      assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: owner.user.id } })).role, "user");
      assert.equal(await prisma.auditLog.count(), 2);
    } finally {
      await prisma.$executeRaw`ALTER TABLE "AuditLog" DROP CONSTRAINT test_reject_role_audit`;
    }
  });

  await t.test("concurrent promotions produce a single update and audit record", async () => {
    const pending: Promise<Response>[] = [];
    try {
      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${owner.user.id}::uuid FOR UPDATE`;
        const change = { ...promote, expectedVersion: 2 };
        pending.push(patch(manager.token, owner.user.id, change), patch(otherManager.token, owner.user.id, change));
        for (let attempt = 0; attempt < 100; attempt++) {
          await tx.$executeRaw`SELECT pg_stat_clear_snapshot()`;
          const [{ waiting }] = await tx.$queryRaw<{ waiting: number }[]>`
            SELECT count(*)::int AS waiting FROM pg_stat_activity
            WHERE datname = current_database() AND pid <> pg_backend_pid()
              AND wait_event_type = 'Lock' AND query ILIKE '%UPDATE%User%'
          `;
          if (waiting === 2) return;
          await delay(20);
        }
        assert.fail("Both requests must reach the conditional update before releasing the row.");
      });
    } finally {
      await Promise.allSettled(pending);
    }
    const responses = await Promise.all(pending);
    assert.deepEqual(responses.map(({ status }) => status).sort(), [200, 409]);
    assert.equal(await prisma.auditLog.count(), 3);
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: owner.user.id } })).role, "admin");
  });

  await t.test("audit limits, filters, stable order, reason visibility and snapshot allowlist", async () => {
    const createdAt = new Date("2099-01-01T00:00:00Z");
    const hiddenActorEvent = randomUUID();
    const ordinaryActorEvent = randomUUID();
    const hiddenTarget = randomUUID();
    const ordinaryTarget = randomUUID();
    const reason = "Причина отмены, сохранённая без изменений.";
    await prisma.auditLog.createMany({ data: [
      {
        id: hiddenActorEvent, actorId: owner.user.id, actorRole: "user", createdAt,
        action: "booking_status_changed", targetType: "booking", targetId: hiddenTarget, reason,
        before: { status: "confirmed", passwordHash: fixtureSecret, userId: manager.user.id },
        after: { status: "cancelled", session: { token: owner.token } },
      },
      {
        id: ordinaryActorEvent, actorId: admin.user.id, actorRole: "admin", createdAt,
        action: "booking_status_changed", targetType: "booking", targetId: ordinaryTarget,
        after: { status: { tokenHash: admin.tokenHash } },
      },
    ] });
    assert.equal((await patch(manager.token, owner.user.id, { ...demote, expectedVersion: 3 })).status, 200);

    const query = `${audit}?action=booking_status_changed&targetType=booking`;
    const history = await safeJson(await request(query, admin.token));
    const privileged = await safeJson(await request(query, manager.token));
    const sortedIds = [hiddenActorEvent, ordinaryActorEvent].sort().reverse();
    assert.deepEqual(history.events.map(({ id }: { id: string }) => id), sortedIds);
    assert.deepEqual(privileged.events.map(({ id }: { id: string }) => id), sortedIds);

    const byId = (report: { events: { id: string }[] }, id: string) => report.events.find((event) => event.id === id);
    const adminCancellation = byId(history, hiddenActorEvent);
    const managerCancellation = byId(privileged, hiddenActorEvent);
    assert.deepEqual(adminCancellation, {
      id: hiddenActorEvent, action: "booking_status_changed", targetType: "booking",
      targetId: hiddenTarget, createdAt: createdAt.toISOString(),
      actorRole: "user", actor: { id: owner.user.id, name: owner.user.name },
      before: { status: "confirmed" }, after: { status: "cancelled" }, hasReason: true,
    });
    assert.ok(managerCancellation);
    assert.equal("hasReason" in managerCancellation, false);
    assert.equal("reason" in managerCancellation && managerCancellation.reason, reason);
    assert.deepEqual(byId(history, ordinaryActorEvent), {
      id: ordinaryActorEvent, action: "booking_status_changed", targetType: "booking",
      targetId: ordinaryTarget, createdAt: createdAt.toISOString(),
      actorRole: "admin", actor: null, before: null, after: null, hasReason: false,
    });

    await prisma.user.update({ where: { id: owner.user.id }, data: { role: "admin" } });
    const elevated = await safeJson(await request(query, admin.token));
    assert.equal((byId(elevated, hiddenActorEvent) as { actor?: unknown })?.actor, null);
    assert.deepEqual(await safeJson(await request(`${audit}?action=user_role_changed`, admin.token)), { events: [] });
    assert.equal((await safeJson(await request(`${audit}?action=user_role_changed`, manager.token))).events.length, 4);
    assert.deepEqual((await safeJson(await request(`${query}&limit=1`, admin.token))).events.map(({ id }: { id: string }) => id), [sortedIds[0]]);
    for (const params of ["limit=0", "limit=101", "limit=1&limit=2", "action=invalid"]) {
      assert.equal((await request(`${audit}?${params}`, manager.token)).status, 400);
    }
    assert.equal((await request(audit, manager.token, {}, "POST")).status, 405);

    await prisma.auditLog.createMany({ data: Array.from({ length: 105 }, () => ({
      actorId: admin.user.id, actorRole: "admin", action: "availability_closed",
      targetType: "availability_closure", targetId: randomUUID(),
    })) });
    assert.equal((await safeJson(await request(audit, manager.token))).events.length, 50);
    assert.equal((await safeJson(await request(`${audit}?limit=100`, manager.token))).events.length, 100);
  });
});
