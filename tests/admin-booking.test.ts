import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { changeAdminBookingStatus } from "../lib/booking/admin";
import { getPrisma } from "../lib/db";
import type { BookingStatus, Role } from "../prisma/generated/client/enums";

const dbUrl = process.env.ADMIN_BOOKING_TEST_DATABASE_URL;
const appUrl = process.env.ADMIN_BOOKING_TEST_APP_URL;
const endpoint = "/api/admin/bookings";
const hour = 3_600_000;

test("administrative bookings HTTP API on PostgreSQL", {
  skip: dbUrl && appUrl ? false : "Set ADMIN_BOOKING_TEST_DATABASE_URL and ADMIN_BOOKING_TEST_APP_URL.",
}, async (t) => {
  assert.equal(new URL(dbUrl!).pathname, "/verde_marea_admin_booking_test");
  process.env.DATABASE_URL = dbUrl;
  const prisma = getPrisma();

  const counts = await Promise.all([
    prisma.user.count(), prisma.table.count(), prisma.booking.count(),
    prisma.notification.count(), prisma.auditLog.count(),
  ]);
  assert.ok(counts.every((count) => count === 0), "Use an empty admin booking test database.");
  t.after(async () => {
    await prisma.notification.deleteMany();
    await prisma.auditLog.deleteMany();
    await prisma.booking.deleteMany();
    await prisma.table.deleteMany();
    await prisma.user.deleteMany();
    await prisma.$disconnect();
  });

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

  async function account(role: Role) {
    const token = randomBytes(32).toString("hex");
    const { id } = await prisma.user.create({
      data: { email: `${role}@admin-booking.test`, name: role, passwordHash: "unused", role },
    });
    await prisma.session.create({ data: {
      userId: id,
      tokenHash: createHash("sha256").update(token).digest("hex"),
      expiresAt: new Date(Date.now() + hour),
    } });
    return { id, token, role };
  }

  const [owner, admin, manager] = await Promise.all([
    account("user"), account("admin"), account("super_admin"),
  ]);

  async function fixture(status: BookingStatus, startsAt: Date) {
    const label = randomUUID();
    const table = await prisma.table.create({ data: { label, capacity: 2 } });
    return prisma.booking.create({ data: {
      userId: owner.id, tableId: table.id, status, startsAt, guestCount: 2,
      endsAt: new Date(startsAt.getTime() + 1.5 * hour),
    } });
  }

  const confirmation = { expectedStatus: "pending", status: "confirmed" };
  const update = (id: string, token: string, change: object = confirmation) =>
    request(`${endpoint}/${id}`, token, change);

  async function effects(id: string) {
    const [booking, audits, notifications] = await Promise.all([
      prisma.booking.findUniqueOrThrow({ where: { id } }),
      prisma.auditLog.findMany({ where: { targetId: id } }),
      prisma.notification.findMany({ where: { bookingId: id } }),
    ]);
    return { status: booking.status, audits, notifications };
  }

  // Active fixture intervals must be disjoint for the same owner.
  let sequence = 0;
  const future = (status: BookingStatus = "pending") =>
    fixture(status, new Date(Date.now() + (6 + 2 * sequence++) * hour));
  const past = (status: BookingStatus = "pending") =>
    fixture(status, new Date(Date.now() - (4 + 2 * sequence++) * hour));

  await t.test("guards all methods and limits the list and detail fields", async () => {
    const booking = await fixture("pending", new Date("2025-04-01T21:00:00Z"));
    await fixture("confirmed", new Date("2025-04-02T09:00:00Z"));
    await fixture("pending", new Date("2025-04-01T19:00:00Z"));
    await fixture("pending", new Date("2025-04-02T21:00:00Z"));
    const detail = `${endpoint}/${booking.id}`;

    for (const [token, status] of [[undefined, 401], [owner.token, 403], ["expired-token", 401]] as const) {
      for (const response of await Promise.all([
        request(endpoint, token), request(detail, token), request(detail, token, confirmation),
      ])) {
        assert.equal(response.status, status);
        assert.equal(response.headers.get("cache-control"), "private, no-store");
      }
    }

    for (const { token } of [admin, manager]) {
      const response = await request(detail, token);
      assert.equal(response.status, 200);
      const details = await response.json();
      assert.deepEqual(Object.keys(details).sort(), [
        "endsAt", "guestCount", "id", "startsAt", "status", "table", "user",
      ]);
      assert.deepEqual(details.user, { name: "user" });
      assert.deepEqual(Object.keys(details.table), ["label"]);
      const read = await request(`${endpoint}?date=2025-04-02&status=pending`, token);
      assert.equal(read.status, 200);
      assert.deepEqual(await read.json(), { bookings: [details] });
      assert.equal((await request(`${endpoint}?date=2025-04-02`, token).then((r) => r.json())).bookings.length, 2);
      assert.equal((await request(`${endpoint}?status=pending`, token).then((r) => r.json())).bookings.length, 3);
    }

    for (const query of ["date=2025-02-29", "status=wrong", "status=pending&status=confirmed", "role=admin"]) {
      assert.equal((await request(`${endpoint}?${query}`, admin.token)).status, 400);
    }
    assert.equal((await request(`${endpoint}/wrong`, admin.token)).status, 400);
    assert.equal((await request(`${endpoint}/${randomUUID()}`, admin.token)).status, 404);
    assert.equal((await update(randomUUID(), admin.token)).status, 404);

    await prisma.user.update({ where: { id: admin.id }, data: { role: "user" } });
    try {
      assert.equal((await request(endpoint, admin.token)).status, 403);
      assert.equal((await update(booking.id, admin.token)).status, 403);
    } finally {
      await prisma.user.update({ where: { id: admin.id }, data: { role: "admin" } });
    }
  });

  await t.test("all seven administrative transitions write one audit and owner notification", async () => {
    const cases = [
      [await future(), "confirmed", undefined],
      [await future(), "cancelled", "Restaurant closed"],
      [await future("confirmed"), "cancelled", "Restaurant closed"],
      [await past(), "completed", "Guest arrived"],
      [await past("confirmed"), "completed", undefined],
      [await past(), "no_show", undefined],
      [await past("confirmed"), "no_show", undefined],
    ] as const;
    for (const [index, [booking, status, reason]] of cases.entries()) {
      const actor = index % 2 ? manager : admin;
      const body = { expectedStatus: booking.status, status, reason: reason && `  ${reason}  ` };
      const response = await update(booking.id, actor.token, body);
      assert.equal(response.status, 200);
      assert.equal((await response.json()).status, status);
      assert.equal((await update(booking.id, actor.token, body)).status, 409);
      const result = await effects(booking.id);
      assert.equal(result.status, status);
      assert.equal(result.audits.length, 1);
      assert.equal(result.notifications.length, 1);
      const [audit] = result.audits;
      assert.equal(audit.actorId, actor.id);
      assert.equal(audit.actorRole, actor.role);
      assert.equal(audit.action, "booking_status_changed");
      assert.equal(audit.targetType, "booking");
      assert.deepEqual(audit.before, { status: booking.status });
      assert.deepEqual(audit.after, { status });
      assert.equal(audit.reason, reason ?? null);
      assert.equal(result.notifications[0].recipientId, owner.id);
      assert.equal(result.notifications[0].status, status);
    }
  });

  await t.test("rejects invalid timing, missing reasons, terminal transitions and client actor fields", async () => {
    const upcoming = await future();
    const elapsed = await past();
    const underway = await fixture("pending", new Date(Date.now() - hour));
    const confirmed = await future("confirmed");
    const terminal = await past("completed");
    for (const [booking, status, extra] of [
      [upcoming, "cancelled", {}],
      [upcoming, "cancelled", { reason: "  " }],
      [upcoming, "completed", { reason: "Guest arrived" }],
      [upcoming, "no_show", {}],
      [upcoming, "confirmed", { actorId: manager.id }],
      [upcoming, "confirmed", { role: "super_admin" }],
      [elapsed, "completed", {}],
      [elapsed, "confirmed", {}],
      [confirmed, "confirmed", {}],
      [underway, "cancelled", { reason: "Closed" }],
      [underway, "confirmed", {}],
      [underway, "no_show", {}],
      [terminal, "no_show", {}],
      [terminal, "pending", {}],
    ] as const) {
      assert.equal((await update(booking.id, admin.token, { expectedStatus: booking.status, status, ...extra })).status, 400);
      assert.deepEqual(await effects(booking.id), { status: booking.status, audits: [], notifications: [] });
    }
  });

  await t.test("status changes respect the exact start and end of the booking", async (boundaryTest) => {
    const pending = await future();
    const endCases = [
      { booking: await future(), status: "completed", reason: "Guest arrived" },
      { booking: await future("confirmed"), status: "completed" },
      { booking: await future(), status: "no_show" },
      { booking: await future("confirmed"), status: "no_show" },
    ];
    const lastEnd = endCases[endCases.length - 1].booking.endsAt.getTime();
    await prisma.session.updateMany({
      where: { userId: admin.id },
      data: { expiresAt: new Date(lastEnd + hour) },
    });
    boundaryTest.mock.timers.enable({ apis: ["Date"] });

    async function changeAt(time: number, bookingId: string, change: object) {
      boundaryTest.mock.timers.setTime(time);
      return changeAdminBookingStatus(admin.token, bookingId, change);
    }

    const start = pending.startsAt.getTime();
    assert.equal((await changeAt(start, pending.id, confirmation)).status, "invalid_transition");
    assert.deepEqual(await effects(pending.id), { status: "pending", audits: [], notifications: [] });
    assert.equal((await changeAt(start - 1, pending.id, confirmation)).status, "ok");

    for (const { booking, status, reason } of endCases) {
      const change = { expectedStatus: booking.status, status, reason };
      const end = booking.endsAt.getTime();
      for (const time of [end - 1, end]) {
        assert.equal((await changeAt(time, booking.id, change)).status, "invalid_transition");
        assert.deepEqual(await effects(booking.id), { status: booking.status, audits: [], notifications: [] });
      }
      assert.equal((await changeAt(end + 1, booking.id, change)).status, "ok");
    }
  });

  await t.test("audit insert failure rolls back the status and notification", async () => {
    const booking = await future();
    await prisma.$executeRaw`ALTER TABLE "AuditLog" ADD CONSTRAINT test_reject_admin_audit CHECK (false) NOT VALID`;
    try {
      assert.equal((await update(booking.id, admin.token)).status, 500);
      assert.deepEqual(await effects(booking.id), { status: "pending", audits: [], notifications: [] });
    } finally {
      await prisma.$executeRaw`ALTER TABLE "AuditLog" DROP CONSTRAINT test_reject_admin_audit`;
    }
  });

  async function race(id: string, send: [() => Promise<Response>, () => Promise<Response>]) {
    const requests: Promise<Response>[] = [];
    try {
      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Booking" WHERE "id" = ${id}::uuid FOR UPDATE`;
        requests.push(...send.map((run) => run()));
        // Both handlers must read the original status and reach their conditional writes.
        for (let attempt = 0; attempt < 100; attempt++) {
          await tx.$executeRaw`SELECT pg_stat_clear_snapshot()`;
          const [result] = await tx.$queryRaw<{ waiting: number }[]>`
            SELECT count(*)::int AS waiting FROM pg_stat_activity
            WHERE datname = current_database() AND pid <> pg_backend_pid()
              AND wait_event_type = 'Lock' AND query ILIKE '%UPDATE%Booking%'
          `;
          if (result.waiting === 2) return;
          await delay(20);
        }
        assert.fail("Both requests must reach the conditional update concurrently.");
      });
    } finally {
      await Promise.allSettled(requests);
    }
    return Promise.all(requests);
  }

  await t.test("two administrators racing the same transition produce one change", async () => {
    const booking = await future();
    const responses = await race(booking.id, [
      () => update(booking.id, admin.token), () => update(booking.id, manager.token),
    ]);
    assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
    const result = await effects(booking.id);
    assert.equal(result.status, "confirmed");
    assert.equal(result.audits.length, 1);
    assert.equal(result.notifications.length, 1);
    assert.equal(result.notifications[0].status, "confirmed");
    assert.equal(result.audits[0].actorId, responses[0].ok ? admin.id : manager.id);
  });

  await t.test("administrative confirmation competing with owner cancellation produces one change", async () => {
    const booking = await future();
    const responses = await race(booking.id, [
      () => update(booking.id, admin.token),
      () => request(`/api/bookings/${booking.id}/cancel`, owner.token, undefined, "PATCH"),
    ]);
    assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
    const result = await effects(booking.id);
    assert.equal(result.status, responses[0].ok ? "confirmed" : "cancelled");
    assert.equal(result.audits.length, 1);
    assert.equal(result.notifications.length, 1);
    assert.equal(result.notifications[0].status, result.status);
    assert.equal(result.audits[0].actorId, responses[0].ok ? admin.id : owner.id);
  });
});
