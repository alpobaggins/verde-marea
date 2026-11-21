import { checkAdminAccess } from "../../../../lib/auth/access";
import { listAdminBookings } from "../../../../lib/booking/admin";
import { accessDenied, reply } from "./response";

export async function GET(request: Request) {
  const access = await checkAdminAccess();
  if (!access.allowed) return accessDenied(access.status);

  const bookings = await listAdminBookings(new URL(request.url).searchParams);
  return bookings
    ? reply({ bookings })
    : reply({ error: "Укажите корректную дату и статус." }, 400);
}
