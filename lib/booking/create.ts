import { z } from "zod";
import { findSessionUser } from "../auth/service";
import { availabilityInput, calculateAvailability, overlappingBookings } from "./availability";
import { bookingTransaction, enforceBookingDeadline } from "./transaction";

export const createBookingInput = availabilityInput.extend({
  startsAt: z.iso.datetime().refine((value) => !/\.\d{4}/.test(value)),
}).strict();

export async function createBooking(token: string | undefined, body: unknown) {
  if (!token) return { status: "unauthorized" } as const;
  return bookingTransaction(async (tx) => {
    const now = new Date();
    const user = await findSessionUser(token, tx, now);
    if (!user) return { status: "unauthorized" } as const;

    const parsed = createBookingInput.safeParse(body);
    if (!parsed.success) return { status: "invalid_input" } as const;
    const input = parsed.data;
    const requestedStart = Date.parse(input.startsAt);
    const availability = await calculateAvailability(input, { tx, now });
    const slot = availability.slots.find(({ startsAt }) => startsAt.getTime() === requestedStart);
    if (!slot) return { status: "unavailable" } as const;

    const existing = await tx.booking.findFirst({
      where: { userId: user.id, ...overlappingBookings(slot) },
      select: { id: true },
    });
    if (existing || slot.startsAt <= new Date()) return { status: "unavailable" } as const;

    const booking = await tx.booking.create({
      data: {
        userId: user.id,
        tableId: slot.tableId,
        startsAt: slot.startsAt,
        endsAt: slot.endsAt,
        guestCount: input.guests,
        status: "pending",
      },
      select: { id: true, startsAt: true, endsAt: true, guestCount: true, status: true },
    });
    await tx.notification.create({
      data: { bookingId: booking.id, recipientId: user.id, status: booking.status },
    });
    await tx.auditLog.create({
      data: {
        actorId: user.id,
        actorRole: user.role,
        action: "booking_created",
        targetType: "booking",
        targetId: booking.id,
        after: {
          userId: user.id,
          tableId: slot.tableId,
          startsAt: booking.startsAt.toISOString(),
          endsAt: booking.endsAt.toISOString(),
          guestCount: booking.guestCount,
          status: booking.status,
        },
      },
    });

    enforceBookingDeadline(booking.startsAt > new Date());
    return { status: "created", booking } as const;
  }, { status: "unavailable" } as const);
}
