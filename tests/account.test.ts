import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { test } from "node:test";
import { bookingDateRange } from "../lib/booking/calendar";
import { formatBookingTime } from "../lib/booking/display";
import { getPrisma } from "../lib/db";

const dbUrl = process.env.ACCOUNT_TEST_DATABASE_URL;
const appUrl = process.env.ACCOUNT_TEST_APP_URL;

test("Moscow calendar bounds and times are anchored to the restaurant zone", () => {
  const zone = "Europe/Moscow";
  assert.deepEqual(bookingDateRange(new Date("2026-12-31T20:59:59.999Z"), zone),
    { first: "2026-12-31", last: "2027-01-13" });
  assert.deepEqual(bookingDateRange(new Date("2026-12-31T21:00:00.000Z"), zone),
    { first: "2027-01-01", last: "2027-01-14" });
  assert.equal(formatBookingTime("2027-01-02T09:00:00.000Z", zone), "12:00");
});

test("protected account and notifications throughout the booking lifecycle", {
  skip: dbUrl && appUrl ? false : "Set ACCOUNT_TEST_DATABASE_URL and ACCOUNT_TEST_APP_URL.",
}, async (t) => {
  assert.equal(new URL(dbUrl!).pathname, "/verde_marea_account_test");
  process.env.DATABASE_URL = dbUrl;
  const prisma = getPrisma();
  async function account() {
    const token = randomBytes(32).toString("hex");
    const user = await prisma.user.create({ data: {
      email: `${randomUUID()}@account.test`, name: "Account test", passwordHash: "unused",
      sessions: { create: {
        tokenHash: createHash("sha256").update(token).digest("hex"),
        expiresAt: new Date(Date.now() + 3_600_000),
      } },
    } });
    return { id: user.id, email: user.email, token };
  }
  function request(path: string, token?: string, options: RequestInit = {}) {
    return fetch(new URL(path, appUrl), {
      ...options, redirect: "manual",
      headers: {
        ...(token && { Cookie: `__Host-verde_session=${token}` }),
        ...options.headers,
      },
    });
  }
  async function accountHtml(token: string) {
    const response = await request("/account", token);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control") ?? "", /no-store/);
    return (await response.text()).split("</main>")[0].replaceAll("<!-- -->", "");
  }
  const today = bookingDateRange(new Date(), "Europe/Moscow").first;
  const target = new Date(`${today}T00:00:00Z`);
  target.setUTCDate(target.getUTCDate() + 2);
  if (target.getUTCDay() === 1) target.setUTCDate(target.getUTCDate() + 1);
  const date = target.toISOString().slice(0, 10);
  const startsAt = `${date}T09:00:00.000Z`;
  const availabilityPath = `/api/availability?date=${date}&guests=2`;

  try {
    const counts = await Promise.all([prisma.user.count(), prisma.table.count(), prisma.availabilityClosure.count()]);
    assert.deepEqual(counts, [0, 0, 0], "Use an empty account test database.");
    try {
      const owner = await account();
      const other = await account();
      const table = await prisma.table.create({ data: { label: "Account table", capacity: 4 } });

      await t.test("guest access redirects and a new account has empty states", async () => {
        const response = await request("/account");
        assert.equal(response.status, 307);
        assert.equal(response.headers.get("location"), "/login");
        const html = await accountHtml(owner.token);
        assert.match(html, /У вас пока нет бронирований/);
        assert.match(html, /Уведомлений пока нет/);
        const page = await request("/booking");
        const bookingHtml = await page.text();
        assert.equal(page.status, 200);
        assert.ok(bookingHtml.includes(`min="${today}"`));
        assert.ok(bookingHtml.includes(`max="${bookingDateRange(new Date(), "Europe/Moscow").last}"`));
      });

      const foreignBooking = await prisma.booking.create({ data: {
        userId: other.id, tableId: table.id, guestCount: 4, status: "no_show",
        startsAt: new Date("2025-10-01T10:00:00Z"), endsAt: new Date("2025-10-01T11:30:00Z"),
        notifications: { create: { status: "no_show" } },
      } });
      const foreignNotification = await prisma.notification.findFirstOrThrow({ where: { bookingId: foreignBooking.id } });
      await prisma.booking.create({ data: {
        userId: owner.id, tableId: table.id, guestCount: 3, status: "completed",
        startsAt: new Date("2025-10-01T09:00:00Z"), endsAt: new Date("2025-10-01T10:30:00Z"),
      } });

      const create = await request("/api/bookings", owner.token, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, startsAt, guests: 2 }),
      });
      assert.equal(create.status, 201);
      const booking: { id: string } = await create.json();
      const notification = await prisma.notification.findFirstOrThrow({ where: { bookingId: booking.id } });

      await t.test("own states are fresh, time is Moscow time and upcoming and history are separated", async () => {
        const html = await accountHtml(owner.token);
        const [, fromUpcoming] = html.split('id="upcoming-heading"');
        const [upcoming, fromHistory] = fromUpcoming.split('id="history-heading"');
        const [history, notifications] = fromHistory.split('id="notifications-heading"');
        assert.match(upcoming, /12:00–13:30/);
        assert.match(upcoming, /Гостей: 2/);
        assert.match(upcoming, /Ожидает подтверждения/);
        assert.doesNotMatch(upcoming, /Завершена/);
        assert.match(history, /Завершена/);
        assert.doesNotMatch(history, /Ожидает подтверждения/);
        assert.match(notifications, /Ожидает подтверждения/);
        assert.match(notifications, /Не прочитано/);
        assert.doesNotMatch(html, /Неявка|Гостей: 4/);
        assert.ok(!html.includes(other.email));

        const otherHtml = await accountHtml(other.token);
        assert.match(otherHtml, /Неявка/);
        assert.doesNotMatch(otherHtml, /Ожидает подтверждения|Завершена/);

        await prisma.booking.update({ where: { id: booking.id }, data: { status: "confirmed" } });
        assert.match(await accountHtml(owner.token), /data-status="confirmed">Подтверждена/);
      });

      await t.test("only recipient can read a notification and concurrent repeats preserve the timestamp", async () => {
        const mark = (id: string, token?: string) => request(`/api/notifications/${id}/read`, token, { method: "PATCH" });
        assert.equal((await mark(notification.id)).status, 401);
        const foreign = await mark(foreignNotification.id, owner.token);
        const missing = await mark(randomUUID(), owner.token);
        assert.equal(foreign.status, 404);
        assert.equal(missing.status, 404);
        assert.deepEqual(await foreign.json(), await missing.json());
        assert.equal((await prisma.notification.findUniqueOrThrow({ where: { id: foreignNotification.id } })).readAt, null);
        const marked = await Promise.all([mark(notification.id, owner.token), mark(notification.id, owner.token)]);
        assert.deepEqual(marked.map(({ status }) => status), [204, 204]);
        const { readAt } = await prisma.notification.findUniqueOrThrow({ where: { id: notification.id } });
        assert.ok(readAt);
        assert.equal((await mark(notification.id, owner.token)).status, 204);
        assert.deepEqual((await prisma.notification.findUniqueOrThrow({ where: { id: notification.id } })).readAt, readAt);
        assert.match(await accountHtml(owner.token), />Прочитано</);
      });

      await t.test("cancellation moves the booking to history and opens the slot; late cancellation is refused", async () => {
        const getSlots = async () => {
          const response = await request(availabilityPath);
          assert.equal(response.status, 200);
          const result: { slots: { startsAt: string }[] } = await response.json();
          return result.slots.map((slot) => slot.startsAt);
        };
        assert.ok(!(await getSlots()).includes(startsAt));
        const cancelPath = `/api/bookings/${booking.id}/cancel`;
        assert.equal((await request(cancelPath, other.token, { method: "PATCH" })).status, 404);
        assert.equal((await request(cancelPath, owner.token, { method: "PATCH" })).status, 200);
        const html = await accountHtml(owner.token);
        const [, history] = html.split('id="history-heading"');
        assert.match(history.split('id="notifications-heading"')[0], /data-status="cancelled">Отменена/);
        assert.match(html, /Предстоящих бронирований нет/);
        assert.match(html, /Бронирование · Отменена/);
        assert.ok((await getSlots()).includes(startsAt));

        const lateStart = new Date(Date.now() + 30 * 60_000);
        const late = await prisma.booking.create({ data: {
          userId: owner.id, tableId: table.id, guestCount: 2,
          startsAt: lateStart, endsAt: new Date(lateStart.getTime() + 90 * 60_000),
        } });
        const upcoming = (await accountHtml(owner.token)).split('id="history-heading"')[0];
        assert.match(upcoming, /Отмена доступна не позднее чем за три часа/);
        assert.doesNotMatch(upcoming, /Отменить бронь/);
        const rejected = await request(`/api/bookings/${late.id}/cancel`, owner.token, { method: "PATCH" });
        assert.equal(rejected.status, 400);
        assert.deepEqual(await rejected.json(), {
          error: "Отменить бронирование можно не позднее чем за три часа до начала.",
        });
      });
    } finally {
      await prisma.notification.deleteMany();
      await prisma.auditLog.deleteMany();
      await prisma.booking.deleteMany();
      await prisma.user.deleteMany();
      await prisma.table.deleteMany();
    }
  } finally {
    await prisma.$disconnect();
  }
});
