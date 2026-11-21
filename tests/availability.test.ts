import assert from "node:assert/strict";
import { test } from "node:test";
import { GET } from "../app/api/availability/route";
import { calculateAvailability } from "../lib/booking/availability";
import { getPrisma } from "../lib/db";

const date = "2026-11-24";
const now = new Date("2026-11-23T21:00:00Z"); // Tuesday at midnight in Moscow.
const input = { date, guests: 2 };
const url = "http://localhost/api/availability";

test("invalid dates, guest counts and duplicate parameters yield HTTP 400", async () => {
  for (const query of [
    "", "date=2026-02-30&guests=2", "date=2026-11-24&guests=0",
    "date=2026-11-24&guests=-1", "date=2026-11-24&guests=1.5",
    "date=2026-11-24&guests=1e2", "date=2026-11-24&guests=2&guests=3",
    "date=2026-11-24&date=2026-11-25&guests=2",
  ]) {
    const response = await GET(new Request(`${url}?${query}`));
    assert.equal(response.status, 400, query);
    assert.equal((await response.json()).status, "invalid_input");
  }
  assert.equal((await calculateAvailability({ ...input, guests: NaN })).status, "invalid_input");
});

test("the public endpoint responds outside the booking horizon without a session", async () => {
  const response = await GET(new Request(`${url}?date=2000-01-01&guests=2`));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { status: "outside_horizon", slots: [] });
});

test("the calendar advances at Moscow midnight and Monday stays closed", async () => {
  assert.equal((await calculateAvailability({ ...input, date: "2026-11-23" }, {
    now: new Date(now.getTime() - 1),
  })).status, "closed");
  assert.equal((await calculateAvailability({ ...input, date: "2026-11-23" }, { now })).status,
    "outside_horizon");
  assert.equal((await calculateAvailability({ ...input, date: "2026-11-30" }, { now })).status,
    "closed");
  assert.equal((await calculateAvailability({ ...input, date: "2026-12-08" }, { now })).status,
    "outside_horizon");
  assert.equal((await calculateAvailability(input, { now: new Date(`${date}T16:30:00Z`) })).status,
    "no_availability");
});

const testDatabaseUrl = process.env.AVAILABILITY_TEST_DATABASE_URL;

test("PostgreSQL availability, schedule, closures and deterministic table selection", {
  skip: testDatabaseUrl ? false : "Set AVAILABILITY_TEST_DATABASE_URL to a migrated empty test database.",
}, async () => {
  assert.match(new URL(testDatabaseUrl!).pathname, /^\/verde_marea_[a-z_]*test$/);
  process.env.DATABASE_URL = testDatabaseUrl;
  const prisma = getPrisma();
  const rollback = new Error("Rollback availability fixtures");
  const at = (time: string) => new Date(`${date}T${time}:00Z`);
  try {
    await assert.rejects(prisma.$transaction(async (tx) => {
      assert.equal(await tx.table.count(), 0, "Use an empty test database.");
      const user = await tx.user.create({
        data: { email: "availability@verde-marea.test", name: "Test guest", passwordHash: "unused" },
      });
      const primary = await tx.table.create({
        data: { id: "ffffffff-ffff-4fff-8fff-ffffffffffff", label: "Primary", capacity: 2 },
      });
      await tx.table.create({ data: { label: "Unavailable", capacity: 8, isAvailable: false } });
      const read = (guests = 2, clock = now, day = date) =>
        calculateAvailability({ date: day, guests }, { now: clock, tx });

      const free = await read();
      assert.equal(free.status, "available");
      assert.deepEqual(free.slots.map(({ startsAt }) => startsAt.toISOString()),
        ["09:00", "10:30", "12:00", "13:30", "15:00", "16:30"].map((time) => at(time).toISOString()));
      assert.deepEqual(free.slots.at(-1)?.endsAt, at("18:00"));
      assert.ok(free.slots.every(({ tableId }) => tableId === primary.id));
      assert.equal((await read(2, at("21:00"), "2026-12-08")).status, "available");
      assert.equal((await read(3)).status, "no_availability");
      assert.equal((await read(2, at("09:00"))).slots.length, 5);

      const active = await tx.booking.create({
        data: { userId: user.id, tableId: primary.id, guestCount: 2,
          startsAt: at("08:30"), endsAt: at("10:00"), status: "pending" },
      });
      const starts = async () => (await read()).slots.map(({ startsAt }) => startsAt.toISOString());
      assert.deepEqual(await starts(), free.slots.slice(1).map(({ startsAt }) => startsAt.toISOString()));
      await tx.booking.update({
        where: { id: active.id },
        data: { startsAt: at("09:00"), endsAt: at("10:30"), status: "confirmed" },
      });
      assert.equal((await read()).slots.length, 5);
      for (const status of ["cancelled", "completed", "no_show"] as const) {
        await tx.booking.create({ data: { userId: user.id, tableId: primary.id, guestCount: 2,
          startsAt: at("10:30"), endsAt: at("12:00"), status } });
      }
      assert.equal((await read()).slots.length, 5);

      await tx.availabilityClosure.create({
        data: { kind: "window", startsAt: at("11:00"), endsAt: at("12:30") },
      });
      assert.deepEqual(await starts(), ["13:30", "15:00", "16:30"].map((time) => at(time).toISOString()));

      const other = await tx.table.create({ data: { label: "Other", capacity: 4 } });
      assert.equal((await read()).slots[0]?.tableId, other.id);
      assert.equal((await read()).slots[1]?.tableId, primary.id);
      const tied = await tx.table.create({ data: {
        id: "00000000-0000-4000-8000-000000000000", label: "Tie", capacity: 2,
      } });
      assert.ok((await read()).slots.every(({ tableId }) => tableId === tied.id));
      assert.deepEqual(await read(), await read());

      await tx.availabilityClosure.create({ data: { kind: "day",
        startsAt: now, endsAt: new Date("2026-11-24T21:00:00Z") } });
      assert.deepEqual(await read(), { status: "closed", slots: [] });
      throw rollback;
    }, { isolationLevel: "Serializable" }), rollback);

    const table = await prisma.table.create({ data: { label: "Public endpoint", capacity: 2 } });
    try {
      const moscowToday = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Moscow" }).format(new Date());
      const tomorrow = new Date(`${moscowToday}T00:00:00Z`);
      tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
      if (tomorrow.getUTCDay() === 1) tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
      const publicDate = tomorrow.toISOString().slice(0, 10);
      const response = await GET(new Request(`${url}?date=${publicDate}&guests=2`));
      assert.equal(response.status, 200);
      const result = await response.json();
      assert.equal(result.status, "available");
      assert.equal(result.slots.length, 6);
      assert.deepEqual(result.slots[0], {
        startsAt: `${publicDate}T09:00:00.000Z`,
        endsAt: `${publicDate}T10:30:00.000Z`,
      });
      const unavailable = await GET(new Request(`${url}?date=${publicDate}&guests=3`));
      assert.deepEqual(await unavailable.json(), { status: "no_availability", slots: [] });
    } finally {
      await prisma.table.delete({ where: { id: table.id } });
    }
  } finally {
    await prisma.$disconnect();
  }
});
