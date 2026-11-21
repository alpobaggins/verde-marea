"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
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
  const [bookingId, setBookingId] = useState("");
  const [selectionCleared, setSelectionCleared] = useState(false);
  const [needsLogin, setNeedsLogin] = useState(!signedIn);

  const errorNotice = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (error) errorNotice.current?.focus();
  }, [error]);

  function resetResult() {
    setSelectionCleared(Boolean(selected));
    setAvailability(null);
    setSelected("");
    setBookingId("");
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
        const booking: { id: string } = await response.json();
        resetResult();
        setBookingId(booking.id);
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
      <form className="auth-form booking-search" onSubmit={search}>
        <label htmlFor="booking-date">Дата
          <input id="booking-date" type="date" required min={first} max={last} value={date}
            disabled={Boolean(pending)} onChange={(event) => { setDate(event.target.value); resetResult(); }} />
        </label>
        <label htmlFor="booking-guests">Количество гостей
          <input id="booking-guests" type="number" min={1} step={1} required value={guests}
            disabled={Boolean(pending)} onChange={(event) => { setGuests(event.target.value); resetResult(); }} />
        </label>
        <button className="button" disabled={Boolean(pending)}>
          <span className="button-label">
            <span aria-hidden={pending === "search"}>Найти свободное время</span>
            {pending === "search" && <span className="button-busy-label">Поиск…</span>}
          </span>
        </button>
      </form>
      <div
        className={!pending && availability?.status === "available" ? "sr-only" : "booking-feedback"}
        data-success={Boolean(bookingId)}
        data-loading={Boolean(pending)}
        role="status"
      >
        {pending === "search" && "Загружаем свободное время…"}
        {pending === "book" && "Отправляем бронирование…"}
        {!pending && availability?.status === "available" && "Выберите время из доступных окон."}
        {!pending && availability && availability.status !== "available" && availabilityMessages[availability.status]}
        {!pending && !availability && !bookingId && selectionCleared && "Выбор времени сброшен. Повторите поиск."}
        {bookingId && (
          <>
            <strong className="booking-confirmation">Бронирование создано</strong>
            <span>Заявка ожидает подтверждения ресторана.</span>
            <span className="booking-reference">Номер бронирования: {bookingId}</span>
            <Link href="/account">Посмотреть в личном кабинете</Link>
          </>
        )}
      </div>
      {error && <p className="guest-error" ref={errorNotice} role="alert" tabIndex={-1}>{error}</p>}
      {availability?.status === "available" && (
        <form className="auth-form booking-results" onSubmit={book}>
          <fieldset disabled={Boolean(pending)} className="booking-slots">
            <legend>Свободное время</legend>
            <div className="booking-slot-grid">
              {availability.slots.map(({ startsAt, endsAt }) => (
                <label key={startsAt}>
                  <input type="radio" name="startsAt" value={startsAt} checked={selected === startsAt}
                    onChange={() => setSelected(startsAt)} />
                  <span>{formatBookingTime(startsAt, timeZone)}–{formatBookingTime(endsAt, timeZone)}</span>
                </label>
              ))}
            </div>
          </fieldset>
          {needsLogin
            ? <Link className="button" href="/login?next=booking">Войти для бронирования</Link>
            : <button className="button" disabled={Boolean(pending) || !selected}>
                <span className="button-label">
                  <span aria-hidden={pending === "book"}>Забронировать</span>
                  {pending === "book" && <span className="button-busy-label">Отправка…</span>}
                </span>
              </button>}
        </form>
      )}
    </>
  );
}
