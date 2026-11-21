import { z } from "zod";
import type { Prisma } from "../../prisma/generated/client/client";
import { BookingStatus } from "../../prisma/generated/client/enums";
import { canAccessAdministration } from "../auth/permissions";
import { findSessionUser } from "../auth/service";
import { getPrisma } from "../db";
import { adminBookingTransitions } from "./admin-transitions";
import { restaurantTimeZone } from "./calendar";
import { bookingTransaction, enforceBookingDeadline } from "./transaction";

const bookingId = z.uuid();
const filters = z.strictObject({
  date: z.iso.date().optional(),
  status: z.enum(BookingStatus).optional(),
});
const statusChange = z.strictObject({
  expectedStatus: z.enum(BookingStatus),
  status: z.enum(["confirmed", "cancelled", "completed", "no_show"]),
  reason: z.string().trim().min(1).refine((reason) => !reason.includes("\0")).optional(),
});
const bookingFields = {
  id: true,
  startsAt: true,
  endsAt: true,
  guestCount: true,
  status: true,
  user: { select: { name: true } },
  table: { select: { label: true } },
} satisfies Prisma.BookingSelect;

export async function listAdminBookings(params: URLSearchParams) {
  if (new Set(params.keys()).size !== params.size) return null;
  const parsed = filters.safeParse(Object.fromEntries(params));
  if (!parsed.success) return null;
  const { date, status } = parsed.data;
  const dayMs = 86_400_000;
  const midnight = date ? Date.parse(`${date}T00:00:00Z`) : undefined;
  const bookings = await getPrisma().booking.findMany({
    where: {
      status,
      // Bound the indexed scan before matching the exact local date, including offset changes.
      startsAt: midnight === undefined ? undefined : {
        gte: new Date(midnight - dayMs),
        lt: new Date(midnight + 2 * dayMs),
      },
    },
    orderBy: [{ startsAt: "asc" }, { id: "asc" }],
    select: bookingFields,
  });
  if (!date) return bookings;
  const formatter = new Intl.DateTimeFormat("sv-SE", {
    timeZone: restaurantTimeZone(), year: "numeric", month: "2-digit", day: "2-digit",
  });
  return bookings.filter(({ startsAt }) => formatter.format(startsAt) === date);
}

export async function findAdminBooking(id: string) {
  if (!bookingId.safeParse(id).success) return { status: "invalid_input" } as const;
  const booking = await getPrisma().booking.findUnique({ where: { id }, select: bookingFields });
  return booking ? { status: "ok", booking } as const : { status: "not_found" } as const;
}

export async function changeAdminBookingStatus(token: string | undefined, id: string, input: unknown) {
  if (!token) return { status: "unauthorized" } as const;

  return bookingTransaction(async (tx) => {
    const actor = await findSessionUser(token, tx);
    if (!actor) return { status: "unauthorized" } as const;
    if (!canAccessAdministration(actor.role)) return { status: "forbidden" } as const;

    const parsed = statusChange.safeParse(input);
    if (!bookingId.safeParse(id).success || !parsed.success) {
      return { status: "invalid_input" } as const;
    }
    const change = parsed.data;
    const booking = await tx.booking.findUnique({
      where: { id },
      select: { ...bookingFields, userId: true },
    });
    if (!booking) return { status: "not_found" } as const;
    if (booking.status !== change.expectedStatus) return { status: "concurrent_change" } as const;
    const transition = adminBookingTransitions(booking, new Date()).find(({ status }) => status === change.status);
    if (!transition || (transition.requiresReason && !change.reason)) return { status: "invalid_transition" } as const;

    const { status, reason } = change;
    const update = await tx.booking.updateMany({
      where: { id, status: change.expectedStatus },
      data: { status },
    });
    if (update.count !== 1) return { status: "concurrent_change" } as const;

    const { userId, ...details } = booking;
    await tx.notification.create({ data: { bookingId: id, recipientId: userId, status } });
    await tx.auditLog.create({
      data: {
        actorId: actor.id,
        actorRole: actor.role,
        action: "booking_status_changed",
        targetType: "booking",
        targetId: id,
        before: { status: booking.status },
        after: { status },
        reason,
      },
    });
    if (status === "confirmed") enforceBookingDeadline(booking.startsAt > new Date());
    return { status: "ok", booking: { ...details, status } } as const;
  }, { status: "invalid_transition" } as const);
}
