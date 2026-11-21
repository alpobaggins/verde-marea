import { z } from "zod";
import { BookingStatus } from "../../prisma/generated/client/enums";
import { findSessionUser } from "../auth/service";
import { activeBookingStatuses } from "./availability";
import { bookingTransaction, enforceBookingDeadline } from "./transaction";

const cancellationNoticeMs = 3 * 60 * 60 * 1_000;
const bookingIdSchema = z.uuid();
const cancelBookingInput = z.strictObject({ expectedStatus: z.enum(BookingStatus) });

export function cancellationDeadlineMet(startsAt: Date, now: Date) {
  return startsAt.getTime() - now.getTime() >= cancellationNoticeMs;
}

export async function cancelBooking(token: string | undefined, id: string, input: unknown) {
  if (!token) return { status: "unauthorized" } as const;

  return bookingTransaction(async (tx) => {
    const user = await findSessionUser(token, tx);
    if (!user) return { status: "unauthorized" } as const;
    const parsed = cancelBookingInput.safeParse(input);
    if (!parsed.success || !bookingIdSchema.safeParse(id).success) {
      return { status: "invalid_input" } as const;
    }
    const { expectedStatus } = parsed.data;

    const booking = await tx.booking.findUnique({
      where: { id_userId: { id, userId: user.id } },
      select: { id: true, startsAt: true, endsAt: true, guestCount: true, status: true },
    });
    if (!booking) return { status: "not_found" } as const;

    if (booking.status !== expectedStatus) {
      return { status: "concurrent_change" } as const;
    }
    if (!activeBookingStatuses.some((status) => status === booking.status)) {
      return { status: "invalid_transition" } as const;
    }
    if (!cancellationDeadlineMet(booking.startsAt, new Date())) {
      return { status: "too_late" } as const;
    }

    const status = "cancelled";
    const update = await tx.booking.updateMany({
      where: { id: booking.id, userId: user.id, status: expectedStatus },
      data: { status },
    });
    if (update.count !== 1) return { status: "concurrent_change" } as const;

    await tx.notification.create({
      data: { bookingId: booking.id, recipientId: user.id, status },
    });
    await tx.auditLog.create({
      data: {
        actorId: user.id,
        actorRole: user.role,
        action: "booking_status_changed",
        targetType: "booking",
        targetId: booking.id,
        before: { status: expectedStatus },
        after: { status },
      },
    });
    enforceBookingDeadline(cancellationDeadlineMet(booking.startsAt, new Date()));
    return { status: "cancelled", booking: { ...booking, status } } as const;
  }, { status: "too_late" } as const);
}
