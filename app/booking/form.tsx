"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { formatBookingTime } from "../../lib/booking/display";
import { apiError } from "./http-error";

type Slot = { startsAt: string; endsAt: string };
type Availability = {
  status: "available" | "closed" | "outside_horizon" | "no_availability";
  slots: Slot[];
};

const availabilityMessages = {
  closed: "На выбранную дату нет открытых окон.",
  outside_horizon: "Дата вне горизонта бронирования. Обновите страницу и выберите дату заново.",
  no_availability: "Свободных окон для указанного количества гостей нет.",
};

export function BookingForm({ first, last, timeZone, signedIn }: {
  first: string; last: string; timeZone: string; signedIn: boolean;
}) {
  const [date, setDate] = useState(first);
  const [guests, setGuests] = useState("2");
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [selected, setSelected] = useState("");
  const [pending, setPending] = useState<"search" | "book" | null>(null);
  const [error, setError] = useState("");
  const [booked, setBooked] = useState(false);
  const [needsLogin, setNeedsLogin] = useState(!signedIn);

  function resetResult() {
    setAvailability(null);
    setSelected("");
    setBooked(false);
    setError("");
  }

  async function loadAvailability() {
    const fallback = "Не удалось загрузить доступные окна.";
    try {
      const query = new URLSearchParams({ date, guests });
      const response = await fetch(`/api/availability?${query}`, { cache: "no-store" });
      if (!response.ok) return await apiError(response, fallback);
      setAvailability(await response.json() as Availability);
      return null;
    } catch {
      return fallback;
    }
  }

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    resetResult();
    setPending("search");
    setError((await loadAvailability()) ?? "");
    setPending(null);
  }

  async function book(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || needsLogin || pending) return;
    setPending("book");
    setError("");
    try {
      const response = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, startsAt: selected, guests: Number(guests) }),
      });
      if (response.status === 201) {
        resetResult();
        setBooked(true);
      } else {
        const message = await apiError(response, "Не удалось создать бронирование.");
        setError(message);
        if (response.status === 401) setNeedsLogin(true);
        if (response.status === 409) {
          setSelected("");
          setAvailability(null);
          if (await loadAvailability()) {
            setError(`${message} Повторите поиск свободных окон.`);
          }
        }
      }
    } catch {
      setError("Не удалось получить результат. Проверьте бронирования в личном кабинете перед повторной отправкой.");
    } finally {
      setPending(null);
    }
  }

  return (
    <>
      <form className="auth-form" onSubmit={search}>
        <label htmlFor="booking-date">Дата
          <input id="booking-date" type="date" required min={first} max={last} value={date}
            disabled={Boolean(pending)} onChange={(event) => { setDate(event.target.value); resetResult(); }} />
        </label>
        <label htmlFor="booking-guests">Количество гостей
          <input id="booking-guests" type="number" min={1} step={1} required value={guests}
            disabled={Boolean(pending)} onChange={(event) => { setGuests(event.target.value); resetResult(); }} />
        </label>
        <button disabled={Boolean(pending)}>Найти свободное время</button>
      </form>
      <div role="status" aria-live="polite">
        {pending === "search" && "Загружаем свободное время…"}
        {pending === "book" && "Отправляем бронирование…"}
        {!pending && availability && availability.status !== "available" && availabilityMessages[availability.status]}
        {booked && <>Бронирование создано. <Link href="/account">Посмотреть в личном кабинете</Link></>}
      </div>
      {error && <p role="alert">{error}</p>}
      {availability?.status === "available" && (
        <form className="auth-form" onSubmit={book}>
          <fieldset disabled={Boolean(pending)} className="booking-slots">
            <legend>Свободное время</legend>
            {availability.slots.map(({ startsAt, endsAt }) => (
              <label key={startsAt}>
                <input type="radio" name="startsAt" value={startsAt} checked={selected === startsAt}
                  onChange={() => setSelected(startsAt)} />
                <span>{formatBookingTime(startsAt, timeZone)}–{formatBookingTime(endsAt, timeZone)}</span>
              </label>
            ))}
          </fieldset>
          {needsLogin
            ? <Link href="/login?next=booking">Войти для бронирования</Link>
            : <button disabled={Boolean(pending) || !selected}>Забронировать</button>}
        </form>
      )}
    </>
  );
}
