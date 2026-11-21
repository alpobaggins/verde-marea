import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { getPrisma } from "../lib/db";
import type { Role } from "../prisma/generated/client/enums";

const dbUrl = process.env.ADMIN_AVAILABILITY_TEST_DATABASE_URL;
const appUrl = process.env.ADMIN_AVAILABILITY_TEST_APP_URL;
const closures = "/api/admin/availability/closures";
const tables = "/api/admin/availability/tables";

function futureDate() {
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Moscow" }).format(new Date());
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 2);
  if (date.getUTCDay() === 1) date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

test("admin availability HTTP and Serializable PostgreSQL writes", {
  skip: dbUrl && appUrl ? false : "Set ADMIN_AVAILABILITY_TEST_DATABASE_URL and ADMIN_AVAILABILITY_TEST_APP_URL.",
}, async (t) => {
  assert.equal(new URL(dbUrl!).pathname, "/verde_marea_admin_availability_test");
  process.env.DATABASE_URL = dbUrl;
  const prisma = getPrisma();
  const counts = await Promise.all([
    prisma.user.count(), prisma.table.count(), prisma.booking.count(),
    prisma.availabilityClosure.count(), prisma.auditLog.count(),
  ]);
  assert.ok(counts.every((count) => count === 0), "Use an empty admin availability test database.");

  async function clearChanges() {
    await prisma.notification.deleteMany();
    await prisma.auditLog.deleteMany();
    await prisma.booking.deleteMany();
    await prisma.availabilityClosure.deleteMany();
    await prisma.table.updateMany({ data: { isAvailable: true } });
  }
  t.afterEach(clearChanges);
  t.after(async () => {
    await prisma.table.deleteMany();
    await prisma.user.deleteMany();
    await prisma.$disconnect();
  });

  async function account(role: Role) {
    const { id } = await prisma.user.create({
      data: { email: `${role}@availability.test`, name: role, role, passwordHash: "unused" },
    });
    const token = randomBytes(32).toString("hex");
    await prisma.session.create({ data: {
      userId: id,
      tokenHash: createHash("sha256").update(token).digest("hex"),
      expiresAt: new Date(Date.now() + 3_600_000),
    } });
    return { id, token };
  }

  const [owner, admin, manager] = await Promise.all([account("user"), account("admin"), account("super_admin")]);
  const table = await prisma.table.create({ data: { label: "Table A", capacity: 2 } });
  const tablePath = `${tables}/${table.id}`;
  const date = futureDate();
  const day = { kind: "day", date };
  const window = { kind: "window", date, start: "12:00" };
  const startsAt = `${date}T09:00:00.000Z`;
  const endsAt = `${date}T10:30:00.000Z`;

  function request(path: string, token?: string, method = "GET", body?: object) {
    return fetch(new URL(path, appUrl), {
      method,
      headers: {
        ...(token ? { Cookie: `__Host-verde_session=${token}` } : {}),
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  const close = (body: object = window, token = admin.token) => request(closures, token, "POST", body);
  const toggle = (isAvailable: boolean, token = admin.token) =>
    request(tablePath, token, "PATCH", { isAvailable });
  const book = (start = startsAt) =>
    request("/api/bookings", owner.token, "POST", { date, startsAt: start, guests: 2 });
  const availability = () => request(`/api/availability?date=${date}&guests=2`).then((r) => r.json());

  function reopen(closure: { id: string; kind: string; startsAt: string; endsAt: string }, token = admin.token) {
    const { id, kind, startsAt, endsAt } = closure;
    return request(`${closures}/${id}`, token, "DELETE", { kind, startsAt, endsAt });
  }

  await t.test("role checks protect each administrative operation", async () => {
    for (const [token, expected] of [[undefined, 401], [owner.token, 403]] as const) {
      for (const response of await Promise.all([
        request(closures, token), request(closures, token, "POST", window),
        request(`${closures}/${randomUUID()}`, token, "DELETE", { kind: "window", startsAt, endsAt }),
        request(tables, token), request(tablePath, token, "PATCH", { isAvailable: false }),
      ])) {
        assert.equal(response.status, expected);
        assert.equal(response.headers.get("cache-control"), "private, no-store");
      }
    }
    assert.equal(await prisma.auditLog.count(), 0);
    for (const { token } of [admin, manager]) {
      assert.deepEqual(await request(closures, token).then((r) => r.json()), { closures: [] });
      assert.deepEqual(await request(tables, token).then((r) => r.json()), { tables: [table] });
    }
  });

  await t.test("only the Moscow calendar date and standard windows can be closed", async () => {
    for (const body of [
      { ...window, start: "12:15" }, { ...window, start: "21:00" },
      { ...window, date: "2025-04-07" }, { ...window, date: "2025-02-29" },
      { ...window, endsAt }, { ...window, actorId: manager.id }, { ...day, start: "12:00" },
    ]) assert.equal((await close(body)).status, 400);
    assert.equal(await prisma.availabilityClosure.count(), 0);
    assert.equal(await prisma.auditLog.count(), 0);

    const response = await close();
    assert.equal(response.status, 201);
    const closure = await response.json();
    assert.equal(closure.startsAt, startsAt);
    assert.equal(closure.endsAt, endsAt);
    const other = await close(day, manager.token);
    assert.equal(other.status, 201);
    const closedDay = await other.json();
    assert.equal(closedDay.startsAt, new Date(Date.parse(`${date}T00:00:00Z`) - 10_800_000).toISOString());
    assert.equal(Date.parse(closedDay.endsAt) - Date.parse(closedDay.startsAt), 86_400_000);
    const log = await prisma.auditLog.findFirstOrThrow({ where: { targetId: closedDay.id } });
    assert.equal(log.actorId, manager.id);
    assert.equal(log.actorRole, "super_admin");
    assert.equal(log.action, "availability_closed");
    assert.deepEqual(log.after, { kind: "day", startsAt: closedDay.startsAt, endsAt: closedDay.endsAt });
  });

  await t.test("adjacent slots stay open and removing a day preserves a nested window", async () => {
    const closure = await close().then((r) => r.json());
    assert.equal((await close()).status, 409);
    assert.equal((await book()).status, 409);
    assert.equal((await availability()).slots[0].startsAt, endsAt);
    assert.deepEqual(Object.keys((await availability()).slots[0]).sort(), ["endsAt", "startsAt"]);
    const closedDay = await close(day).then((r) => r.json());
    assert.deepEqual(await availability(), { status: "closed", slots: [] });
    assert.equal((await reopen({ ...closedDay, kind: "window" })).status, 409);
    assert.equal((await reopen(closedDay, manager.token)).status, 204);
    assert.equal((await reopen(closedDay)).status, 409);
    assert.equal((await availability()).slots[0].startsAt, endsAt);
    assert.equal((await book(endsAt)).status, 201);
    assert.equal((await reopen(closure)).status, 204);
    assert.equal((await availability()).slots[0].startsAt, startsAt);
    assert.equal(await prisma.auditLog.count({ where: { targetId: closure.id } }), 2);
  });

  await t.test("active future bookings protect the date, window and table", async () => {
    const original = await book().then((r) => r.json());
    for (const status of ["pending", "confirmed"] as const) {
      await prisma.booking.update({ where: { id: original.id }, data: { status } });
      const before = await prisma.booking.findUniqueOrThrow({ where: { id: original.id } });
      for (const response of [await close(), await close(day), await toggle(false)]) {
        assert.equal(response.status, 409);
        assert.match((await response.json()).error, /активное будущее бронирование/);
      }
      assert.deepEqual(await prisma.booking.findUnique({ where: { id: original.id } }), before);
    }
    assert.equal(await prisma.auditLog.count(), 1);
    await prisma.booking.update({ where: { id: original.id }, data: { status: "cancelled" } });
    assert.equal((await close()).status, 201);
    assert.equal((await toggle(false)).status, 200);
    assert.equal((await prisma.booking.findUniqueOrThrow({ where: { id: original.id } })).status, "cancelled");
  });

  await t.test("disabling excludes a table from selection and enabling restores eligibility", async () => {
    assert.equal((await request(tablePath, admin.token, "PATCH", { isAvailable: false, capacity: 20 })).status, 400);
    assert.equal((await toggle(false)).status, 200);
    assert.equal((await toggle(false, manager.token)).status, 409);
    assert.deepEqual(await availability(), { status: "no_availability", slots: [] });
    assert.equal((await book()).status, 409);
    assert.equal((await toggle(true, manager.token)).status, 200);
    assert.equal((await book()).status, 201);
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { targetId: table.id, actorId: manager.id },
    });
    assert.equal(audit.action, "table_availability_changed");
    assert.deepEqual(audit.before, { isAvailable: false });
    assert.deepEqual(audit.after, { isAvailable: true });
    assert.equal(await prisma.auditLog.count({ where: { targetId: table.id } }), 2);
  });

  await t.test("audit failure rolls back creation, reopening and table changes", async () => {
    const closure = await close().then((r) => r.json());
    await prisma.$executeRaw`ALTER TABLE "AuditLog" ADD CONSTRAINT test_reject_availability_audit CHECK (false) NOT VALID`;
    try {
      assert.equal((await close(day)).status, 500);
      assert.equal((await reopen(closure)).status, 500);
      assert.equal((await toggle(false)).status, 500);
      assert.equal(await prisma.availabilityClosure.count(), 1);
      assert.ok(await prisma.availabilityClosure.findUnique({ where: { id: closure.id } }));
      assert.equal((await prisma.table.findUniqueOrThrow({ where: { id: table.id } })).isAvailable, true);
      assert.equal(await prisma.auditLog.count(), 1);
    } finally {
      await prisma.$executeRaw`ALTER TABLE "AuditLog" DROP CONSTRAINT test_reject_availability_audit`;
    }
  });

  await t.test("concurrent duplicates and competing requests against the same table write once", async () => {
    const duplicate = await Promise.all([close(), close(window, manager.token)]);
    assert.deepEqual(duplicate.map((r) => r.status).sort(), [201, 409]);
    const toggles = await Promise.all([toggle(false), toggle(false, manager.token)]);
    assert.deepEqual(toggles.map((r) => r.status).sort(), [200, 409]);
    const closure = await duplicate.find((r) => r.ok)!.json();
    const removals = await Promise.all([reopen(closure), reopen(closure, manager.token)]);
    assert.deepEqual(removals.map((r) => r.status).sort(), [204, 409]);
    assert.equal(await prisma.auditLog.count(), 3);
  });

  async function race(change: () => Promise<Response>) {
    const pending: Promise<Response>[] = [];
    try {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(75202)`;
        pending.push(book(), change());
        // Both operations reach their writes after reading the other resource.
        for (let attempt = 0; attempt < 100; attempt++) {
          const [{ waiting }] = await tx.$queryRaw<{ waiting: number }[]>`
            SELECT count(*)::int AS waiting FROM pg_locks
            WHERE locktype = 'advisory' AND classid = 0 AND objid = 75202
              AND mode = 'ShareLock' AND NOT granted
          `;
          if (waiting === 2) return;
          await delay(20);
        }
        assert.fail("Both writes must reach the advisory gate.");
      });
    } finally {
      await Promise.allSettled(pending);
    }
    return Promise.all(pending);
  }

  await t.test("booking races with closure and disabling each commit exactly one operation", async () => {
    await prisma.$executeRaw`
      CREATE FUNCTION test_availability_gate() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        PERFORM pg_advisory_xact_lock_shared(75202);
        RETURN NEW;
      END $$
    `;
    try {
      await prisma.$executeRaw`CREATE TRIGGER test_availability_gate BEFORE INSERT ON "Booking" FOR EACH ROW EXECUTE FUNCTION test_availability_gate()`;
      await prisma.$executeRaw`CREATE TRIGGER test_availability_gate BEFORE INSERT ON "AvailabilityClosure" FOR EACH ROW EXECUTE FUNCTION test_availability_gate()`;
      await prisma.$executeRaw`CREATE TRIGGER test_availability_gate BEFORE UPDATE ON "Table" FOR EACH ROW EXECUTE FUNCTION test_availability_gate()`;
      for (const [operation, success] of [[() => close(), 201], [() => toggle(false), 200]] as const) {
        const [booking, change] = await race(operation);
        assert.deepEqual([booking.status, change.status], booking.ok ? [201, 409] : [409, success]);
        assert.equal(await prisma.booking.count(), booking.ok ? 1 : 0);
        assert.equal(await prisma.notification.count(), booking.ok ? 1 : 0);
        assert.equal(await prisma.auditLog.count(), 1);
        assert.equal(await prisma.availabilityClosure.count(), change.ok && success === 201 ? 1 : 0);
        assert.equal((await prisma.table.findUniqueOrThrow({ where: { id: table.id } })).isAvailable, !(change.ok && success === 200));
        await clearChanges();
      }
    } finally {
      await prisma.$executeRaw`DROP FUNCTION test_availability_gate() CASCADE`;
    }
  });
});
