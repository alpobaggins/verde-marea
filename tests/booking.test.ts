import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { test, type TestContext } from "node:test";
import type { Prisma } from "../prisma/generated/client/client";
import type { BookingStatus } from "../prisma/generated/client/enums";
import { getPrisma } from "../lib/db";
import { changeAdminBookingStatus } from "../lib/booking/admin";
import { overlappingBookings } from "../lib/booking/availability";
import { cancellationDeadlineMet, cancelBooking } from "../lib/booking/cancel";
import { createBooking, createBookingInput } from "../lib/booking/create";

const dbUrl = process.env.BOOKING_TEST_DATABASE_URL;
const appUrl = process.env.BOOKING_TEST_APP_URL;

const moscowToday = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Moscow" }).format(new Date());
const day = new Date(`${moscowToday}T00:00:00Z`);
day.setUTCDate(day.getUTCDate() + 2);
if (day.getUTCDay() === 1) day.setUTCDate(day.getUTCDate() + 1);
const date = day.toISOString().slice(0, 10);
const startsAt = `${date}T09:00:00.000Z`;
const endsAt = `${date}T10:30:00.000Z`;
const input = { date, startsAt, guests: 2 };
const forbidden = { userId: "someone-else", role: "super_admin", status: "confirmed", tableId: "other-table" };

test("booking input rejects invalid values and each client-controlled assignment", () => {
  for (const [key, value] of Object.entries(forbidden)) {
    assert.equal(createBookingInput.safeParse({ ...input, [key]: value }).success, false);
  }
  for (const invalid of [
    { date: "2026-02-30" }, { startsAt: "12:00" }, { startsAt: `${date}T25:00:00Z` },
    { guests: 0 }, { guests: -1 }, { guests: 1.5 }, { guests: "2" },
  ]) {
    assert.equal(createBookingInput.safeParse({ ...input, ...invalid }).success, false);
  }
});

test("cancellation includes the exact three-hour threshold", () => {
  const start = new Date(startsAt);
  const threshold = start.getTime() - 3 * 60 * 60 * 1_000;
  assert.equal(cancellationDeadlineMet(start, new Date(threshold - 1)), true);
  assert.equal(cancellationDeadlineMet(start, new Date(threshold)), true);
  assert.equal(cancellationDeadlineMet(start, new Date(threshold + 1)), false);
});

test("booking HTTP API and Serializable PostgreSQL writes", {
  skip: dbUrl && appUrl ? false : "Set BOOKING_TEST_DATABASE_URL and BOOKING_TEST_APP_URL.",
}, async (t) => {
  assert.equal(new URL(dbUrl!).pathname, "/verde_marea_booking_test");
  process.env.DATABASE_URL = dbUrl;
  const prisma = getPrisma();
  const post = (token?: string, body: object = input) => fetch(new URL("/api/bookings", appUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Cookie: `__Host-verde_session=${token}` } : {}),
    },
    body: JSON.stringify(body),
  });

  async function clearBookings() {
    await prisma.notification.deleteMany();
    await prisma.auditLog.deleteMany();
    await prisma.booking.deleteMany();
    await prisma.availabilityClosure.deleteMany();
  }

  async function account(role: "user" | "admin") {
    const token = randomBytes(32).toString("hex");
    const user = await prisma.user.create({
      data: { email: `${role}@booking.test`, name: role, role, passwordHash: "unused" },
    });
    await prisma.session.create({ data: {
      userId: user.id,
      tokenHash: createHash("sha256").update(token).digest("hex"),
      expiresAt: new Date(Date.now() + 3_600_000),
    } });
    return { id: user.id, token };
  }

  try {
    const counts = await Promise.all([
      prisma.user.count(), prisma.table.count(), prisma.booking.count(),
      prisma.notification.count(), prisma.auditLog.count(), prisma.availabilityClosure.count(),
    ]);
    assert.ok(counts.every((count) => count === 0), "Use an empty booking test database.");

    const owner = await account("admin");
    const other = await account("user");
    const primary = await prisma.table.create({ data: { label: "Two seats", capacity: 2 } });

    try {
      await t.test("requires a live session and validates the JSON payload", async () => {
        assert.equal((await post()).status, 401);
        assert.equal((await post(randomBytes(32).toString("hex"))).status, 401);
        for (const [field, value] of Object.entries(forbidden)) {
          assert.equal((await post(owner.token, { ...input, [field]: value })).status, 400, field);
        }
        for (const invalid of [{ date: "not-a-date" }, { startsAt: "12:00" }, { guests: 0 }]) {
          assert.equal((await post(owner.token, { ...input, ...invalid })).status, 400);
        }
        assert.equal((await fetch(new URL("/api/bookings", appUrl), {
          method: "POST",
          headers: { "Content-Type": "application/json", Cookie: `__Host-verde_session=${owner.token}` },
          body: "{",
        })).status, 400);
        assert.equal(await prisma.booking.count(), 0);
      });

      await t.test("rejects closed windows, insufficient capacity and times outside schedule or horizon", async () => {
        assert.equal((await post(owner.token, { ...input, startsAt: `${date}T18:00:00.000Z` })).status, 409);
        assert.equal((await post(owner.token, { ...input, date: "2000-01-04", startsAt: "2000-01-04T09:00:00Z" })).status, 409);
        assert.equal((await post(owner.token, { ...input, guests: 3 })).status, 409);
        const closure = await prisma.availabilityClosure.create({ data: {
          kind: "window", startsAt: new Date(`${date}T08:30:00Z`), endsAt: new Date(`${date}T09:30:00Z`),
        } });
        try {
          assert.equal((await post(owner.token)).status, 409);
          assert.equal(await prisma.booking.count(), 0);
        } finally {
          await prisma.availabilityClosure.delete({ where: { id: closure.id } });
        }
      });

      await t.test("creates pending booking, notification and audit for the session owner and releases terminal bookings", async () => {
        const response = await post(owner.token);
        assert.equal(response.status, 201);
        const booking = await response.json();
        assert.deepEqual(booking, { id: booking.id, startsAt, endsAt, guestCount: 2, status: "pending" });
        const stored = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
        assert.equal(stored.userId, owner.id);
        assert.equal(stored.tableId, primary.id);
        const notification = await prisma.notification.findFirstOrThrow();
        assert.equal(notification.bookingId, booking.id);
        assert.equal(notification.recipientId, owner.id);
        assert.equal(notification.status, "pending");
        const audit = await prisma.auditLog.findFirstOrThrow();
        assert.equal(audit.actorId, owner.id);
        assert.equal(audit.actorRole, "admin");
        assert.equal(audit.action, "booking_created");
        assert.equal(audit.targetType, "booking");
        assert.equal(audit.targetId, booking.id);
        assert.deepEqual(audit.after, { userId: owner.id, tableId: primary.id, startsAt, endsAt, guestCount: 2, status: "pending" });

        assert.equal((await post(owner.token)).status, 409);
        assert.equal((await post(other.token)).status, 409);
        await prisma.booking.update({ where: { id: booking.id }, data: { status: "confirmed" } });
        assert.equal((await post(other.token)).status, 409);
        await prisma.booking.update({ where: { id: booking.id }, data: { status: "cancelled" } });
        const afterCancellation = await post(other.token);
        assert.equal(afterCancellation.status, 201);
        await prisma.booking.update({ where: { id: (await afterCancellation.json()).id }, data: { status: "completed" } });
        assert.equal((await post(owner.token)).status, 201);
        await clearBookings();
      });

      await t.test("rolls back the booking and notification when the mandatory audit insert fails", async () => {
        await prisma.$executeRaw`ALTER TABLE "AuditLog" ADD CONSTRAINT test_reject_audit CHECK (false)`;
        try {
          const failed = await post(owner.token);
          assert.equal(failed.status, 500);
          assert.deepEqual(await failed.json(), { error: "Не удалось создать бронирование." });
          assert.deepEqual(await Promise.all([
            prisma.booking.count(), prisma.notification.count(), prisma.auditLog.count(),
          ]), [0, 0, 0]);
        } finally {
          await prisma.$executeRaw`ALTER TABLE "AuditLog" DROP CONSTRAINT test_reject_audit`;
        }
      });

      async function waitForBookingInserts(tx: Prisma.TransactionClient, expected: number) {
        for (let attempt = 0; attempt < 150; attempt++) {
          const [{ waiting }] = await tx.$queryRaw<{ waiting: number }[]>`
            SELECT count(*)::int AS waiting FROM pg_locks
            WHERE locktype = 'advisory' AND classid = 0 AND objid = 74291
              AND database = (SELECT oid FROM pg_database WHERE datname = current_database())
              AND NOT granted
          `;
          if (waiting === expected) return;
          await delay(20);
        }
        assert.fail("Expected booking transactions to reach the insert concurrently.");
      }

      // Both HTTP transactions must pass the availability read before either can insert.
      async function concurrentPair(first: string, second: string) {
        const requests: Promise<Response>[] = [];
        try {
          await prisma.$transaction(async (tx) => {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(74291)`;
            requests.push(post(first), post(second));
            await waitForBookingInserts(tx, 2);
          });
        } finally {
          await Promise.allSettled(requests);
        }
        return Promise.all(requests);
      }

      await t.test("concurrent requests for one or two tables, and duplicate owner with an alternative table", async (race) => {
        await prisma.$executeRaw`
          CREATE FUNCTION test_gate_booking() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN
            PERFORM pg_advisory_xact_lock_shared(74291);
            RETURN NEW;
          END;
          $$`;
        try {
          await prisma.$executeRaw`
            CREATE TRIGGER test_gate_booking BEFORE INSERT ON "Booking"
            FOR EACH ROW EXECUTE FUNCTION test_gate_booking()`;
          await race.test("last table: one 201 and one 409", async () => {
            const responses = await concurrentPair(owner.token, other.token);
            assert.deepEqual(responses.map(({ status }) => status).sort(), [201, 409]);
            const conflict = responses.find(({ status }) => status === 409)!;
            assert.deepEqual(await conflict.json(), { error: "Выбранное окно больше недоступно." });
            assert.deepEqual(await Promise.all([
              prisma.booking.count(), prisma.notification.count(), prisma.auditLog.count(),
            ]), [1, 1, 1]);
            await clearBookings();
          });

          const larger = await prisma.table.create({ data: { label: "Four seats", capacity: 4 } });
          await race.test("two tables: two 201, each booking uses a different table", async () => {
            assert.deepEqual((await concurrentPair(owner.token, other.token)).map(({ status }) => status), [201, 201]);
            const bookings = await prisma.booking.findMany();
            assert.deepEqual(bookings.map(({ tableId }) => tableId).sort(), [primary.id, larger.id].sort());
            assert.deepEqual(await Promise.all([prisma.notification.count(), prisma.auditLog.count()]), [2, 2]);
            await clearBookings();
          });
          await race.test("same owner: one 201 and one 409 despite an alternative table", async () => {
            assert.deepEqual((await concurrentPair(owner.token, owner.token)).map(({ status }) => status).sort(), [201, 409]);
            assert.equal(await prisma.booking.count(), 1);
            assert.equal((await post(owner.token)).status, 409);
            await clearBookings();
          });

          await race.test("concurrent closure commits and the booking retries against it", async () => {
            let request: Promise<Response> | undefined;
            try {
              await prisma.$transaction(async (tx) => {
                await tx.$executeRaw`SELECT pg_advisory_xact_lock(74291)`;
                request = post(owner.token);
                await waitForBookingInserts(tx, 1);
                const interval = { startsAt: new Date(startsAt), endsAt: new Date(endsAt) };
                assert.equal(await tx.booking.count({ where: overlappingBookings(interval) }), 0);
                await tx.availabilityClosure.create({ data: { kind: "window", ...interval } });
              }, { isolationLevel: "Serializable" });
            } finally {
              if (request) await Promise.allSettled([request]);
            }
            assert.equal((await request)?.status, 409);
            assert.equal(await prisma.availabilityClosure.count(), 1);
            assert.deepEqual(await Promise.all([
              prisma.booking.count(), prisma.notification.count(), prisma.auditLog.count(),
            ]), [0, 0, 0]);
            await clearBookings();
          });
        } finally {
          await prisma.$executeRaw`DROP TRIGGER IF EXISTS test_gate_booking ON "Booking"`;
          await prisma.$executeRaw`DROP FUNCTION test_gate_booking()`;
        }
      });
      await t.test("persistent serialization failures stop after three total attempts", async () => {
        await prisma.$executeRaw`CREATE SEQUENCE test_booking_attempts`;
        try {
          await prisma.$executeRaw`
            CREATE FUNCTION test_fail_serialization() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
              PERFORM nextval('test_booking_attempts');
              RAISE EXCEPTION 'test serialization failure' USING ERRCODE = '40001';
            END;
            $$`;
          try {
            await prisma.$executeRaw`
              CREATE TRIGGER test_fail_serialization BEFORE INSERT ON "Booking"
              FOR EACH ROW EXECUTE FUNCTION test_fail_serialization()`;
            const failed = await post(owner.token);
            assert.equal(failed.status, 409);
            assert.deepEqual(await failed.json(), { error: "Доступность изменилась. Обновите список окон." });
            const [attempts] = await prisma.$queryRaw<{ count: number }[]>`
              SELECT last_value::int AS count FROM test_booking_attempts
            `;
            assert.equal(attempts.count, 3);
            assert.deepEqual(await Promise.all([
              prisma.booking.count(), prisma.notification.count(), prisma.auditLog.count(),
            ]), [0, 0, 0]);
          } finally {
            await prisma.$executeRaw`DROP FUNCTION test_fail_serialization() CASCADE`;
          }
        } finally {
          await prisma.$executeRaw`DROP SEQUENCE test_booking_attempts`;
        }
      });

      await t.test("Prisma adapter errors at COMMIT use the narrow retry policy", async (commitTests) => {
        await prisma.$executeRaw`CREATE SEQUENCE test_commit_attempts`;
        await prisma.$executeRaw`CREATE TABLE test_commit_failure (code text NOT NULL)`;
        await prisma.$executeRaw`
          CREATE FUNCTION test_fail_commit() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN
            PERFORM nextval('test_commit_attempts');
            RAISE EXCEPTION 'test commit failure' USING ERRCODE = (SELECT code FROM test_commit_failure);
          END;
          $$`;
        try {
          await prisma.$executeRaw`
            CREATE CONSTRAINT TRIGGER test_fail_commit AFTER INSERT ON "AuditLog"
            DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION test_fail_commit()`;

          for (const { code, expectedStatus, expectedAttempts, error } of [
            { code: "40001", expectedStatus: 409, expectedAttempts: 3, error: "Доступность изменилась. Обновите список окон." },
            { code: "40P01", expectedStatus: 409, expectedAttempts: 3, error: "Доступность изменилась. Обновите список окон." },
            { code: "23514", expectedStatus: 500, expectedAttempts: 1, error: "Не удалось создать бронирование." },
          ]) {
            await commitTests.test(`SQLSTATE ${code} gives HTTP ${expectedStatus} after ${expectedAttempts} attempts`, async () => {
              await prisma.$executeRaw`DELETE FROM test_commit_failure`;
              await prisma.$executeRaw`INSERT INTO test_commit_failure (code) VALUES (${code})`;
              await prisma.$executeRaw`ALTER SEQUENCE test_commit_attempts RESTART WITH 1`;
              const failed = await post(owner.token);
              assert.equal(failed.status, expectedStatus);
              assert.deepEqual(await failed.json(), { error });
              const [attempts] = await prisma.$queryRaw<{ count: number; is_called: boolean }[]>`
                SELECT last_value::int AS count, is_called FROM test_commit_attempts
              `;
              assert.equal(attempts.is_called, true);
              assert.equal(attempts.count, expectedAttempts);
              assert.deepEqual(await Promise.all([
                prisma.booking.count(), prisma.notification.count(), prisma.auditLog.count(),
              ]), [0, 0, 0]);
            });
          }
        } finally {
          await prisma.$executeRaw`DROP FUNCTION test_fail_commit() CASCADE`;
          await prisma.$executeRaw`DROP TABLE test_commit_failure`;
          await prisma.$executeRaw`DROP SEQUENCE test_commit_attempts`;
        }
      });

      await t.test("booking write deadlines with a controlled clock and PostgreSQL locks", async (deadlineTests) => {
        await clearBookings();
        const start = Date.parse(startsAt);
        const cancellationDeadline = start - 3 * 60 * 60_000;
        await prisma.session.updateMany({
          where: { userId: { in: [owner.id, other.id] } },
          data: { expiresAt: new Date(endsAt) },
        });

        const counts = () => Promise.all([prisma.booking.count(), prisma.auditLog.count(), prisma.notification.count()]);
        const pending = () => prisma.booking.create({ data: {
          userId: other.id, tableId: primary.id, guestCount: 2,
          startsAt: new Date(startsAt), endsAt: new Date(endsAt),
        } });

        async function crossDeadline<T>(
          context: TestContext, deadline: number, table: "Booking" | "AuditLog", operation: () => Promise<T>,
        ) {
          context.mock.timers.enable({ apis: ["Date"], now: deadline - 1 });
          let running: Promise<T> | undefined;
          try {
            await prisma.$transaction(async (tx) => {
              if (table === "Booking") {
                await tx.$executeRaw`LOCK TABLE "Booking" IN SHARE MODE`;
              } else {
                await tx.$executeRaw`LOCK TABLE "AuditLog" IN SHARE MODE`;
              }
              running = operation();
              for (let attempt = 0; attempt < 100; attempt++) {
                await tx.$executeRaw`SELECT pg_stat_clear_snapshot()`;
                const [{ waiting }] = await tx.$queryRaw<{ waiting: boolean }[]>`
                  SELECT EXISTS (
                    SELECT 1 FROM pg_stat_activity
                    WHERE datname = current_database() AND wait_event_type = 'Lock'
                      AND pg_backend_pid() = ANY (pg_blocking_pids(pid))
                  ) AS waiting
                `;
                if (waiting) {
                  context.mock.timers.setTime(deadline + 1);
                  return;
                }
                await delay(20);
              }
              assert.fail(`Expected the operation to wait for the ${table} lock.`);
            });
          } finally {
            if (running) await Promise.allSettled([running]);
          }
          assert.ok(running);
          return running;
        }

        await deadlineTests.test("creation rejects at the exact slot start", async (boundaryTest) => {
          boundaryTest.mock.timers.enable({ apis: ["Date"], now: start });
          assert.equal((await createBooking(other.token, input)).status, "unavailable");
          assert.deepEqual(await counts(), [0, 0, 0]);
        });

        await deadlineTests.test("creation rolls back when its insert crosses the slot start", async (lockTest) => {
          try {
            const result = await crossDeadline(lockTest, start, "Booking", () => createBooking(other.token, input));
            assert.equal(result.status, "unavailable");
            assert.deepEqual(await counts(), [0, 0, 0]);
          } finally {
            await clearBookings();
          }
        });

        await deadlineTests.test("creation rolls back when the audit write crosses the slot start", async (lockTest) => {
          try {
            const result = await crossDeadline(lockTest, start, "AuditLog", () => createBooking(other.token, input));
            assert.equal(result.status, "unavailable");
            assert.deepEqual(await counts(), [0, 0, 0]);
          } finally {
            await clearBookings();
          }
        });

        await deadlineTests.test("owner cancellation rejects after waiting past the cutoff and succeeds at it", async (lockTest) => {
          const booking = await pending();
          const cancel = () => cancelBooking(other.token, booking.id, { expectedStatus: "pending" });
          try {
            assert.equal((await crossDeadline(lockTest, cancellationDeadline, "Booking", cancel)).status, "too_late");
            assert.deepEqual(await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } }), booking);
            assert.deepEqual(await counts(), [1, 0, 0]);

            lockTest.mock.timers.setTime(cancellationDeadline);
            assert.equal((await cancel()).status, "cancelled");
            assert.deepEqual(await counts(), [1, 1, 1]);
          } finally {
            await clearBookings();
          }
        });

        await deadlineTests.test("administrative confirmation rejects at the start and after waiting past it", async (lockTest) => {
          const booking = await pending();
          const confirm = () => changeAdminBookingStatus(owner.token, booking.id, {
            expectedStatus: "pending", status: "confirmed",
          });
          try {
            assert.equal((await crossDeadline(lockTest, start, "Booking", confirm)).status, "invalid_transition");
            assert.deepEqual(await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } }), booking);
            assert.deepEqual(await counts(), [1, 0, 0]);

            lockTest.mock.timers.setTime(start);
            assert.equal((await confirm()).status, "invalid_transition");
            assert.deepEqual(await counts(), [1, 0, 0]);
          } finally {
            await clearBookings();
          }
        });
      });

      await t.test("owner cancellation HTTP and Serializable PostgreSQL writes", async (cancelTests) => {
        await clearBookings();
        // Keep one candidate so the availability assertion proves this table was released.
        await prisma.table.deleteMany({ where: { id: { not: primary.id } } });

        const patch = (id: string, token?: string, body: object | null = { expectedStatus: "pending" }) =>
          fetch(new URL(`/api/bookings/${id}/cancel`, appUrl), {
            method: "PATCH",
            headers: {
              ...(token ? { Cookie: `__Host-verde_session=${token}` } : {}),
              ...(body ? { "Content-Type": "application/json" } : {}),
            },
            body: body ? JSON.stringify(body) : undefined,
          });
        const fixture = (status: BookingStatus, start = new Date(startsAt)) => prisma.booking.create({
          data: {
            userId: owner.id, tableId: primary.id, status, guestCount: 2,
            startsAt: start, endsAt: new Date(start.getTime() + 90 * 60_000),
          },
        });
        const summary = (id: string) => Promise.all([
          prisma.booking.findUniqueOrThrow({ where: { id }, select: { status: true } }),
          prisma.auditLog.count({ where: { targetId: id } }),
          prisma.notification.count({ where: { bookingId: id } }),
        ]);

        await cancelTests.test("session, malformed requests and ownership are checked without exposing another booking", async () => {
          const booking = await fixture("pending");
          assert.equal((await patch(booking.id)).status, 401);
          assert.equal((await patch(booking.id, randomBytes(32).toString("hex"))).status, 401);
          assert.equal((await patch("invalid", owner.token)).status, 400);

          const foreign = await patch(booking.id, other.token);
          const missing = await patch(randomUUID(), other.token);
          assert.equal(foreign.status, 404);
          assert.equal(missing.status, foreign.status);
          assert.deepEqual(await foreign.json(), await missing.json());
          assert.deepEqual(await summary(booking.id), [{ status: "pending" }, 0, 0]);
          await clearBookings();
        });

        await cancelTests.test("missing or invalid expected status is rejected without side effects", async () => {
          const booking = await fixture("pending");
          for (const body of [null, {}, { expectedStatus: "unknown" }, { expectedStatus: null },
            { expectedStatus: "pending", userId: owner.id }]) {
            assert.equal((await patch(booking.id, owner.token, body)).status, 400);
            assert.deepEqual(await summary(booking.id), [{ status: "pending" }, 0, 0]);
          }
          await clearBookings();
        });

        await cancelTests.test("pending cancellation preserves history, releases its table and writes exactly one event pair", async () => {
          const booking = await fixture("pending");
          assert.equal((await post(other.token)).status, 409);
          const response = await patch(booking.id, owner.token);
          assert.equal(response.status, 200);
          assert.deepEqual(await response.json(), { id: booking.id, startsAt, endsAt, guestCount: 2, status: "cancelled" });
          const stored = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
          assert.deepEqual(stored, { ...booking, status: "cancelled", updatedAt: stored.updatedAt });
          const audit = await prisma.auditLog.findFirstOrThrow({ where: { targetId: booking.id } });
          assert.equal(audit.actorId, owner.id);
          assert.equal(audit.actorRole, "admin");
          assert.equal(audit.action, "booking_status_changed");
          assert.equal(audit.targetType, "booking");
          assert.deepEqual(audit.before, { status: "pending" });
          assert.deepEqual(audit.after, { status: "cancelled" });
          const notification = await prisma.notification.findFirstOrThrow({ where: { bookingId: booking.id } });
          assert.equal(notification.recipientId, owner.id);
          assert.equal(notification.status, "cancelled");

          assert.equal((await patch(booking.id, owner.token)).status, 409);
          assert.deepEqual(await summary(booking.id), [{ status: "cancelled" }, 1, 1]);
          const replacement = await post(other.token);
          assert.equal(replacement.status, 201);
          const { id } = await replacement.json();
          assert.equal((await prisma.booking.findUniqueOrThrow({ where: { id } })).tableId, primary.id);
          await clearBookings();
        });

        await cancelTests.test("confirmed can be cancelled; terminal states and late cancellations are rejected", async () => {
          const confirmed = await fixture("confirmed", new Date(Date.now() + 181 * 60_000));
          assert.equal((await patch(confirmed.id, owner.token, { expectedStatus: "confirmed" })).status, 200);
          const late = await fixture("pending", new Date(Date.now() + 179 * 60_000));
          assert.equal((await patch(late.id, owner.token)).status, 400);
          assert.deepEqual(await summary(late.id), [{ status: "pending" }, 0, 0]);
          for (const status of ["cancelled", "completed", "no_show"] as const) {
            const booking = await fixture(status);
            assert.equal((await patch(booking.id, owner.token, { expectedStatus: status })).status, 400);
            assert.deepEqual(await summary(booking.id), [{ status }, 0, 0]);
          }
          await clearBookings();
        });

        await cancelTests.test("mandatory audit failure rolls back the cancellation and notification", async () => {
          const booking = await fixture("confirmed");
          await prisma.$executeRaw`ALTER TABLE "AuditLog" ADD CONSTRAINT test_reject_cancel_audit CHECK (false)`;
          try {
            const response = await patch(booking.id, owner.token, { expectedStatus: "confirmed" });
            assert.equal(response.status, 500);
            assert.deepEqual(await response.json(), { error: "Не удалось отменить бронирование." });
            assert.deepEqual(await summary(booking.id), [{ status: "confirmed" }, 0, 0]);
          } finally {
            await prisma.$executeRaw`ALTER TABLE "AuditLog" DROP CONSTRAINT test_reject_cancel_audit`;
          }
          assert.equal((await patch(booking.id, owner.token, { expectedStatus: "confirmed" })).status, 200);
          await clearBookings();
        });

        // Hold the booking row until the HTTP requests have read the original status.
        async function raceCancellation(id: string, count: number, confirm = false) {
          const requests: Promise<Response>[] = [];
          try {
            await prisma.$transaction(async (tx) => {
              await tx.$queryRaw`SELECT "id" FROM "Booking" WHERE "id" = ${id}::uuid FOR UPDATE`;
              for (let i = 0; i < count; i++) requests.push(patch(id, owner.token));
              let waiting = 0;
              for (let attempt = 0; attempt < 100; attempt++) {
                await tx.$executeRaw`SELECT pg_stat_clear_snapshot()`;
                const [result] = await tx.$queryRaw<{ waiting: number }[]>`
                  SELECT count(*)::int AS waiting FROM pg_stat_activity
                  WHERE datname = current_database() AND pid <> pg_backend_pid()
                    AND wait_event_type = 'Lock' AND query ILIKE '%UPDATE%Booking%'
                `;
                waiting = result.waiting;
                if (waiting === count) break;
                await delay(20);
              }
              assert.equal(waiting, count, "Cancellation attempts must reach the conditional update concurrently.");
              if (confirm) {
                await tx.booking.update({ where: { id, status: "pending" }, data: { status: "confirmed" } });
              }
            }, { isolationLevel: "Serializable" });
          } finally {
            await Promise.allSettled(requests);
          }
          return Promise.all(requests);
        }

        await cancelTests.test("two simultaneous cancellations yield one 200 and one 409", async () => {
          const booking = await fixture("pending");
          const responses = await raceCancellation(booking.id, 2);
          assert.deepEqual(responses.map(({ status }) => status).sort(), [200, 409]);
          assert.deepEqual(await summary(booking.id), [{ status: "cancelled" }, 1, 1]);
          await clearBookings();
        });

        await cancelTests.test("a concurrent confirmation wins without silently cancelling the newer status", async () => {
          const booking = await fixture("pending");
          const [response] = await raceCancellation(booking.id, 1, true);
          assert.equal(response.status, 409);
          assert.deepEqual(await summary(booking.id), [{ status: "confirmed" }, 0, 0]);
          assert.equal((await patch(booking.id, owner.token, { expectedStatus: "confirmed" })).status, 200);
          assert.deepEqual(await summary(booking.id), [{ status: "cancelled" }, 1, 1]);
          await clearBookings();
        });

        await cancelTests.test("persistent serialization failures stop cancellation after three attempts", async () => {
          const booking = await fixture("pending");
          await prisma.$executeRaw`CREATE SEQUENCE test_cancel_attempts`;
          await prisma.$executeRaw`
            CREATE FUNCTION test_fail_cancel_serialization() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
              PERFORM nextval('test_cancel_attempts');
              RAISE EXCEPTION 'test cancellation serialization failure' USING ERRCODE = '40001';
            END;
            $$`;
          try {
            await prisma.$executeRaw`
              CREATE TRIGGER test_fail_cancel_serialization BEFORE UPDATE ON "Booking"
              FOR EACH ROW EXECUTE FUNCTION test_fail_cancel_serialization()`;
            assert.equal((await patch(booking.id, owner.token)).status, 409);
            const [attempts] = await prisma.$queryRaw<{ count: number }[]>`
              SELECT last_value::int AS count FROM test_cancel_attempts
            `;
            assert.equal(attempts.count, 3);
            assert.deepEqual(await summary(booking.id), [{ status: "pending" }, 0, 0]);
          } finally {
            await prisma.$executeRaw`DROP FUNCTION test_fail_cancel_serialization() CASCADE`;
            await prisma.$executeRaw`DROP SEQUENCE test_cancel_attempts`;
          }
        });
      });
    } finally {
      await clearBookings();
      await prisma.session.deleteMany();
      await prisma.user.deleteMany();
      await prisma.table.deleteMany();
    }
  } finally {
    await prisma.$disconnect();
  }
});
