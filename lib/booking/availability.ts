import { z } from "zod";
import type { Prisma } from "../../prisma/generated/client/client";
import { getPrisma } from "../db";
import { bookingDateRange, restaurantTimeZone, restaurantWindows } from "./calendar";

export const availabilityInput = z.object({
  date: z.iso.date(),
  guests: z.number().int().positive(),
});

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

export async function calculateAvailability(
  input: z.input<typeof availabilityInput>,
  { tx, now = new Date() }: { tx?: Prisma.TransactionClient; now?: Date } = {},
): Promise<Availability> {
  const parsed = availabilityInput.safeParse(input);
  if (!parsed.success) return { status: "invalid_input", slots: [] };
  const { date, guests } = parsed.data;
  const timeZone = restaurantTimeZone();
  const { first, last } = bookingDateRange(now, timeZone);
  if (date < first || date > last) return { status: "outside_horizon", slots: [] };

  const scheduled = restaurantWindows(date, timeZone);
  if (!scheduled) return { status: "closed", slots: [] };
  const windows = scheduled.filter(({ startsAt }) => startsAt > now);
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
