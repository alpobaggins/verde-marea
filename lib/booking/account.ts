import "server-only";

import { getPrisma } from "../db";
import { activeBookingStatuses } from "./availability";
import { cancellationDeadlineMet } from "./cancel";

export async function readAccountBookings(userId: string, now: Date) {
  const bookings = await getPrisma().booking.findMany({
    where: { userId },
    select: { id: true, startsAt: true, endsAt: true, guestCount: true, status: true },
    orderBy: [{ startsAt: "desc" }, { id: "asc" }],
  });

  const upcoming = [];
  const history = [];
  for (const booking of bookings) {
    const active = activeBookingStatuses.some((status) => status === booking.status);
    if (active && booking.endsAt > now) {
      upcoming.push({ ...booking, canCancel: cancellationDeadlineMet(booking.startsAt, now) });
    } else {
      history.push({ ...booking, canCancel: false });
    }
  }
  upcoming.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  return { upcoming, history };
}
