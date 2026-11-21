import { z } from "zod";
import type { BookingStatus } from "../../prisma/generated/client/enums";
import { findSessionUser } from "../auth/service";
import { activeBookingStatuses } from "./availability";
import { bookingTransaction } from "./transaction";

const cancellationNoticeMs = 3 * 60 * 60 * 1_000;
const bookingIdSchema = z.uuid();

export function cancellationDeadlineMet(startsAt: Date, now: Date) {
  return startsAt.getTime() - now.getTime() >= cancellationNoticeMs;
}

export async function cancelBooking(token: string | undefined, id: string, hasUnexpectedInput: boolean) {
  if (!token) return { status: "unauthorized" } as const;

  // Keep the first eligible status across retries so they cannot cancel a newer version.
  let expectedStatus: BookingStatus | undefined;

  return bookingTransaction(async (tx) => {
    const user = await findSessionUser(token, tx);
    if (!user) return { status: "unauthorized" } as const;
    if (hasUnexpectedInput || !bookingIdSchema.safeParse(id).success) {
      return { status: "invalid_input" } as const;
    }

    const booking = await tx.booking.findUnique({
      where: { id_userId: { id, userId: user.id } },
      select: { id: true, startsAt: true, endsAt: true, guestCount: true, status: true },
    });
    if (!booking) return { status: "not_found" } as const;

    if (expectedStatus !== undefined && booking.status !== expectedStatus) {
      return { status: "concurrent_change" } as const;
    }
    if (!activeBookingStatuses.some((status) => status === booking.status)) {
      return { status: "invalid_transition" } as const;
    }
    if (!cancellationDeadlineMet(booking.startsAt, new Date())) {
      return { status: "too_late" } as const;
    }

    expectedStatus = booking.status;
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
    return { status: "cancelled", booking: { ...booking, status } } as const;
  });
}
