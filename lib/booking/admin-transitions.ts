import type { BookingStatus } from "../../prisma/generated/client/enums";

type TargetStatus = Exclude<BookingStatus, "pending">;
type Transition = { status: TargetStatus; requiresReason: boolean };

export function adminBookingTransitions(booking: {
  status: BookingStatus;
  startsAt: Date | string;
  endsAt: Date | string;
}, now: Date): Transition[] {
  if (booking.status !== "pending" && booking.status !== "confirmed") return [];
  if (now < new Date(booking.startsAt)) {
    const cancel = { status: "cancelled", requiresReason: true } as const;
    return booking.status === "pending" ? [{ status: "confirmed", requiresReason: false }, cancel] : [cancel];
  }
  if (now > new Date(booking.endsAt)) return [
    { status: "completed", requiresReason: booking.status === "pending" },
    { status: "no_show", requiresReason: false },
  ];
  return [];
}
