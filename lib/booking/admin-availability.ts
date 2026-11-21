import { z } from "zod";
import { canAccessAdministration } from "../auth/permissions";
import { findSessionUser } from "../auth/service";
import { getPrisma } from "../db";
import { activeBookingStatuses, overlappingBookings } from "./availability";
import { restaurantDay, restaurantTimeZone, restaurantWindows } from "./calendar";
import { bookingTransaction } from "./transaction";

const idSchema = z.uuid();
const createInput = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("day"), date: z.iso.date() }),
  z.strictObject({ kind: z.literal("window"), date: z.iso.date(), start: z.iso.time({ precision: -1 }) }),
]);
const reopenInput = z.strictObject({
  kind: z.enum(["day", "window"]),
  startsAt: z.iso.datetime({ precision: 3 }),
  endsAt: z.iso.datetime({ precision: 3 }),
});
const tableInput = z.strictObject({ isAvailable: z.boolean() });

type Change =
  | { action: "close"; input: unknown }
  | { action: "reopen" | "table"; id: string; input: unknown };

export function listClosures() {
  return getPrisma().availabilityClosure.findMany({ orderBy: [{ startsAt: "asc" }, { id: "asc" }] });
}

export function listTables() {
  return getPrisma().table.findMany({ orderBy: { label: "asc" } });
}

function closureInterval(input: z.output<typeof createInput>) {
  const timeZone = restaurantTimeZone();
  if (input.kind === "day") return restaurantDay(input.date, timeZone);
  const clock = new Intl.DateTimeFormat("en-GB", {
    timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });
  return restaurantWindows(input.date, timeZone)?.find(({ startsAt }) => clock.format(startsAt) === input.start);
}

function closureSnapshot(closure: {
  kind: "day" | "window";
  startsAt: Date;
  endsAt: Date;
}) {
  return {
    kind: closure.kind,
    startsAt: closure.startsAt.toISOString(),
    endsAt: closure.endsAt.toISOString(),
  };
}

export async function changeAdminAvailability(token: string | undefined, change: Change) {
  if (!token) return { status: "unauthorized" } as const;

  return bookingTransaction(async (tx) => {
    const now = new Date();
    const actor = await findSessionUser(token, tx, now);
    if (!actor) return { status: "unauthorized" } as const;
    if (!canAccessAdministration(actor.role)) return { status: "forbidden" } as const;
    const audit = { actorId: actor.id, actorRole: actor.role };
    const invalid = { status: "invalid_input" } as const;
    const conflict = { status: "concurrent_change" } as const;

    if (change.action === "close") {
      const parsed = createInput.safeParse(change.input);
      if (!parsed.success) return invalid;
      const interval = closureInterval(parsed.data);
      if (!interval) return invalid;

      const overlap = overlappingBookings(interval);
      const booking = await tx.booking.findFirst({
        where: { ...overlap, startsAt: { ...overlap.startsAt, gt: now } },
        select: { id: true },
      });
      if (booking) return { status: "booking_conflict" } as const;

      const [closure] = await tx.availabilityClosure.createManyAndReturn({
        data: { ...interval, kind: parsed.data.kind },
        skipDuplicates: true,
      });
      if (!closure) return { status: "duplicate" } as const;
      await tx.auditLog.create({ data: {
        ...audit, action: "availability_closed", targetType: "availability_closure",
        targetId: closure.id, after: closureSnapshot(closure),
      } });
      return { status: "created", closure } as const;
    }

    if (!idSchema.safeParse(change.id).success) return invalid;
    const { id } = change;
    if (change.action === "reopen") {
      const parsed = reopenInput.safeParse(change.input);
      if (!parsed.success) return invalid;
      const removed = await tx.availabilityClosure.deleteMany({ where: { id, ...parsed.data } });
      if (!removed.count) return conflict;
      await tx.auditLog.create({ data: {
        ...audit, action: "availability_reopened", targetType: "availability_closure",
        targetId: id, before: parsed.data,
      } });
      return { status: "removed" } as const;
    }

    const parsed = tableInput.safeParse(change.input);
    if (!parsed.success) return invalid;
    const { isAvailable } = parsed.data;
    const table = await tx.table.findUnique({ where: { id } });
    if (!table) return { status: "not_found" } as const;
    if (table.isAvailable === isAvailable) return conflict;
    if (isAvailable && table.capacity <= 0) return invalid;
    if (!isAvailable) {
      const booking = await tx.booking.findFirst({
        where: { tableId: id, startsAt: { gt: now }, status: { in: [...activeBookingStatuses] } },
        select: { id: true },
      });
      if (booking) return { status: "booking_conflict" } as const;
    }

    const updated = await tx.table.updateMany({
      where: { id, isAvailable: table.isAvailable },
      data: { isAvailable },
    });
    if (!updated.count) return conflict;
    await tx.auditLog.create({ data: {
      ...audit, action: "table_availability_changed", targetType: "table", targetId: id,
      before: { isAvailable: table.isAvailable }, after: { isAvailable },
    } });
    return { status: "updated", table: { ...table, isAvailable } } as const;
  });
}
