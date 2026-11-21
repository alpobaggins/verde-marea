import { z } from "zod";
import type { Prisma } from "../../prisma/generated/client/client";
import { getPrisma } from "../db";
import { bookingDateRange, restaurantTimeZone } from "./calendar";

export const availabilityInput = z.object({
  date: z.iso.date(),
  guests: z.number().int().positive(),
});

const slotMinutes = 90;
const minuteMs = 60_000;

type Interval = { startsAt: Date; endsAt: Date };
type Slot = Interval & { tableId: string };

type Availability =
  | { status: "available"; slots: Slot[] }
  | { status: "invalid_input" | "outside_horizon" | "closed" | "no_availability"; slots: [] };

export const activeBookingStatuses = ["pending", "confirmed"] as const;

export function overlappingBookings({ startsAt, endsAt }: Interval) {
  return {
    startsAt: { lt: endsAt },
    endsAt: { gt: startsAt },
    status: { in: [...activeBookingStatuses] },
  };
}

function overlaps(left: Interval, right: Interval) {
  return left.startsAt < right.endsAt && right.startsAt < left.endsAt;
}

function localDateTime(instant: Date, formatter: Intl.DateTimeFormat) {
  const parts = formatter.formatToParts(instant);
  const { year, month, day, hour, minute, second } = Object.fromEntries(
    parts.map(({ type, value }) => [type, value]),
  );
  return `${year}-${month}-${day}T${hour}:${minute}:${second}`;
}

function toInstant(local: string, formatter: Intl.DateTimeFormat) {
  const wallTime = Date.parse(`${local}Z`);
  const offsetAt = (instant: number) =>
    Date.parse(`${localDateTime(new Date(instant), formatter)}Z`) - instant;

  const estimate = wallTime - offsetAt(wallTime);
  const instant = new Date(wallTime - offsetAt(estimate));
  return localDateTime(instant, formatter) === local ? instant : null;
}

export async function calculateAvailability(
  input: z.input<typeof availabilityInput>,
  { tx, now = new Date() }: { tx?: Prisma.TransactionClient; now?: Date } = {},
): Promise<Availability> {
  const parsed = availabilityInput.safeParse(input);
  if (!parsed.success) return { status: "invalid_input", slots: [] };
  const { date, guests } = parsed.data;
  const timeZone = restaurantTimeZone();
  const formatter = new Intl.DateTimeFormat("sv-SE", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });
  const { first, last } = bookingDateRange(now, timeZone);
  if (date < first || date > last) return { status: "outside_horizon", slots: [] };

  const calendarDay = new Date(`${date}T00:00:00Z`);
  if (calendarDay.getUTCDay() === 1) return { status: "closed", slots: [] };

  const closing = toInstant(`${date}T21:00:00`, formatter);
  if (!closing) return { status: "closed", slots: [] };

  const windows = ["12:00", "13:30", "15:00", "16:30", "18:00", "19:30"].flatMap(
    (time): Interval[] => {
      const startsAt = toInstant(`${date}T${time}:00`, formatter);
      if (!startsAt || startsAt <= now) return [];
      const endsAt = new Date(startsAt.getTime() + slotMinutes * minuteMs);
      return endsAt <= closing ? [{ startsAt, endsAt }] : [];
    },
  );
  if (windows.length === 0) return { status: "no_availability", slots: [] };

  const { status, ...range } = overlappingBookings({
    startsAt: windows[0].startsAt,
    endsAt: windows[windows.length - 1].endsAt,
  });

  async function readAvailability(db: Prisma.TransactionClient): Promise<Availability> {
    const closures = await db.availabilityClosure.findMany({
      where: range,
      select: { startsAt: true, endsAt: true },
    });
    const openWindows = windows.filter((slot) => !closures.some((closure) => overlaps(slot, closure)));
    if (openWindows.length === 0) return { status: "closed", slots: [] };

    // PostgreSQL stores capacity as a signed 32-bit integer.
    if (guests > 2_147_483_647) return { status: "no_availability", slots: [] };
    const tables = await db.table.findMany({
      where: { isAvailable: true, capacity: { gte: guests } },
      orderBy: [{ capacity: "asc" }, { id: "asc" }],
      select: {
        id: true,
        bookings: {
          where: { ...range, status },
          select: { startsAt: true, endsAt: true },
        },
      },
    });

    const slots = openWindows.flatMap((slot): Slot[] => {
      const table = tables.find(({ bookings }) => !bookings.some((booking) => overlaps(slot, booking)));
      return table ? [{ ...slot, tableId: table.id }] : [];
    });
    return slots.length ? { status: "available", slots } : { status: "no_availability", slots: [] };
  }

  return tx
    ? readAvailability(tx)
    : getPrisma().$transaction(readAvailability, { isolationLevel: "RepeatableRead" });
}
