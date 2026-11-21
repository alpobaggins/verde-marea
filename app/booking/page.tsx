import { GuestHeader } from "../../components/guest-header";
import { currentUser } from "../../lib/auth/session";
import { bookingDateRange, restaurantTimeZone } from "../../lib/booking/calendar";
import { BookingForm } from "./form";

export default async function BookingPage() {
  const user = await currentUser();
  const timeZone = restaurantTimeZone();
  const { first, last } = bookingDateRange(new Date(), timeZone);

  return (
    <>
      <GuestHeader page="booking" />
      <main className="guest-container booking-screen">
        <header className="guest-intro">
          <h1 className="guest-title">Бронирование стола</h1>
          <p>Выберите дату и количество гостей, чтобы посмотреть свободное время.</p>
        </header>
        <div className="booking-layout">
          <div className="guest-panel booking-controls">
            <BookingForm first={first} last={last} timeZone={timeZone} signedIn={Boolean(user)} />
          </div>
          <aside className="booking-hours" aria-labelledby="booking-hours">
            <h2 id="booking-hours">Часы работы</h2>
            <p>Вторник–воскресенье, 12:00–21:00</p>
            <p>Время ресторана — {timeZone === "Europe/Moscow" ? "московское" : timeZone}.</p>
          </aside>
        </div>
      </main>
    </>
  );
}
