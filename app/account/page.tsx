import Link from "next/link";
import { requireSignedInUser } from "../../lib/auth/access";
import { canAccessAdministration } from "../../lib/auth/permissions";
import { readAccountBookings } from "../../lib/booking/account";
import { restaurantTimeZone } from "../../lib/booking/calendar";
import { bookingStatusLabels, formatBookingDate, formatBookingTime } from "../../lib/booking/display";
import { readAccountNotifications } from "../../lib/notifications/service";
import { LogoutForm } from "../auth-form";
import { ResourceAction } from "./resource-action";

type AccountBooking = Awaited<ReturnType<typeof readAccountBookings>>["upcoming"][number];

function BookingList({ bookings, timeZone, upcoming }: {
  bookings: AccountBooking[]; timeZone: string; upcoming?: boolean;
}) {
  if (!bookings.length) return <p>{upcoming ? "Предстоящих бронирований нет." : "История пока пуста."}</p>;

  return (
    <ul className="booking-list">
      {bookings.map((booking) => (
        <li className="booking-card" key={booking.id}>
          <div>
            <p><time dateTime={booking.startsAt.toISOString()}>{formatBookingDate(booking.startsAt, timeZone)} · {formatBookingTime(booking.startsAt, timeZone)}–{formatBookingTime(booking.endsAt, timeZone)}</time></p>
            <p>Гостей: {booking.guestCount}</p>
            <p className="booking-status" data-status={booking.status}>{bookingStatusLabels[booking.status]}</p>
          </div>
          {booking.canCancel
            ? <ResourceAction id={booking.id} kind="cancel" />
            : upcoming && <p>Отмена доступна не позднее чем за три часа до начала.</p>}
        </li>
      ))}
    </ul>
  );
}

export default async function AccountPage() {
  const user = await requireSignedInUser();
  const timeZone = restaurantTimeZone();
  const [{ upcoming, history }, notifications] = await Promise.all([
    readAccountBookings(user.id, new Date()),
    readAccountNotifications(user.id),
  ]);

  return (
    <main className="auth-page booking-page">
      <nav aria-label="Основная навигация">
        <Link href="/">Verde Marea</Link>
        <Link href="/booking">Забронировать стол</Link>
        {canAccessAdministration(user.role) && <Link href="/admin" prefetch={false}>Администрирование</Link>}
      </nav>
      <h1>Личный кабинет</h1>
      <p className="break-all">Email: {user.email}</p>
      <section aria-labelledby="booking-heading">
        <h2 id="booking-heading">Мои бронирования</h2>
        <p>Время ресторана — {timeZone === "Europe/Moscow" ? "московское" : timeZone}.</p>
        {!upcoming.length && !history.length ? <p>У вас пока нет бронирований.</p> : (
          <>
            <section aria-labelledby="upcoming-heading">
              <h3 id="upcoming-heading">Предстоящие и текущие</h3>
              <BookingList bookings={upcoming} timeZone={timeZone} upcoming />
            </section>
            <section aria-labelledby="history-heading">
              <h3 id="history-heading">История</h3>
              <BookingList bookings={history} timeZone={timeZone} />
            </section>
          </>
        )}
      </section>
      <section aria-labelledby="notifications-heading">
        <h2 id="notifications-heading">Уведомления</h2>
        {notifications.length === 0 ? <p>Уведомлений пока нет.</p> : (
          <ul className="booking-list">
            {notifications.map((notification) => (
              <li className="booking-card" key={notification.id}>
                <div>
                  <p>Бронирование · {bookingStatusLabels[notification.status]}</p>
                  <time dateTime={notification.createdAt.toISOString()}>{formatBookingDate(notification.createdAt, timeZone)} · {formatBookingTime(notification.createdAt, timeZone)}</time>
                  <p>{notification.readAt ? "Прочитано" : <strong>Не прочитано</strong>}</p>
                </div>
                {!notification.readAt && <ResourceAction id={notification.id} kind="read" />}
              </li>
            ))}
          </ul>
        )}
      </section>
      <LogoutForm />
    </main>
  );
}
