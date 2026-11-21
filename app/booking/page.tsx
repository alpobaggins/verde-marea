import Link from "next/link";
import { currentUser } from "../../lib/auth/session";
import { bookingDateRange, restaurantTimeZone } from "../../lib/booking/calendar";
import { BookingForm } from "./form";

export default async function BookingPage() {
  const user = await currentUser();
  const timeZone = restaurantTimeZone();
  const { first, last } = bookingDateRange(new Date(), timeZone);

  return (
    <main className="auth-page booking-page">
      <nav aria-label="Основная навигация">
        <Link href="/">Verde Marea</Link>
        <Link href="/account">Личный кабинет</Link>
      </nav>
      <h1>Бронирование стола</h1>
      <p>Время ресторана — {timeZone === "Europe/Moscow" ? "московское" : timeZone}.</p>
      <BookingForm first={first} last={last} timeZone={timeZone} signedIn={Boolean(user)} />
    </main>
  );
}
