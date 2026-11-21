"use client";

import { useEffect, useRef, useState } from "react";
import { ConfirmDialog } from "../../components/confirm-dialog";
import type { BookingStatus } from "../../prisma/generated/client/enums";
import { adminBookingTransitions } from "../../lib/booking/admin-transitions";
import { bookingStatusLabels, formatBookingDate, formatBookingTime } from "../../lib/booking/display";
import { AdminData, AdminTable, filterQuery, MutationNotice, useAdminData, useAdminMutation } from "./workspace";

type Booking = {
  id: string; startsAt: string; endsAt: string; guestCount: number; status: BookingStatus;
  user: { name: string }; table: { label: string };
};

function Status({ status }: { status: BookingStatus }) {
  return <span className="booking-status" data-status={status}>{bookingStatusLabels[status]}</span>;
}

export function AdminBookings({ timeZone }: { timeZone: string }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string>();
  const { result, reload } = useAdminData<{ bookings: Booking[] }>(`/api/admin/bookings${query ? `?${query}` : ""}`);

  return (
    <>
      <form className="admin-filters" onSubmit={(event) => {
        event.preventDefault();
        setSelected(undefined);
        setQuery(filterQuery(event.currentTarget));
      }} onReset={() => { setSelected(undefined); setQuery(""); }}>
        <label>Дата<input type="date" name="date" /></label>
        <label>Статус<select name="status">
          <option value="">Все статусы</option>
          {Object.entries(bookingStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
        <button className="button" type="submit">Применить</button>
        <button className="button button-secondary" type="reset">Сбросить</button>
      </form>
      <AdminData result={result} retry={reload}>{({ bookings }) => bookings.length ? (
        <AdminTable label="Список бронирований" headings={["Дата и время", "Клиент", "Стол", "Гостей", "Статус", "Действие"]}>
          {bookings.map((booking) => (
            <tr key={booking.id} data-selected={selected === booking.id}>
              <td><span>{formatBookingDate(booking.startsAt, timeZone)}</span><br />
                <span className="workspace-muted">{formatBookingTime(booking.startsAt, timeZone)}–{formatBookingTime(booking.endsAt, timeZone)}</span></td>
              <td>{booking.user.name}</td><td>{booking.table.label}</td><td>{booking.guestCount}</td>
              <td><Status status={booking.status} /></td>
              <td><button type="button" className="button button-secondary" aria-expanded={selected === booking.id}
                aria-controls={selected === booking.id ? "booking-details" : undefined}
                aria-label={`Детали брони ${booking.user.name} · ${formatBookingDate(booking.startsAt, timeZone)} ${formatBookingTime(booking.startsAt, timeZone)} · ${booking.table.label}`}
                onClick={() => setSelected(selected === booking.id ? undefined : booking.id)}>Детали</button></td>
            </tr>
          ))}
        </AdminTable>
      ) : <p className="workspace-muted">{query ? "По этим фильтрам бронирований нет." : "Бронирований пока нет."}</p>}</AdminData>
      {selected && <BookingDetails key={selected} id={selected} timeZone={timeZone} reloadList={reload} />}
    </>
  );
}

function BookingDetails({ id, timeZone, reloadList }: { id: string; timeZone: string; reloadList: () => void }) {
  const path = `/api/admin/bookings/${encodeURIComponent(id)}`;
  const { result, reload } = useAdminData<Booking>(path);
  const mutation = useAdminMutation(() => { reload(); reloadList(); });
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);

  return (
    <section id="booking-details" className="workspace-panel workspace-stack" aria-labelledby="booking-details-heading">
      <h3 id="booking-details-heading" ref={heading} tabIndex={-1}>Детали бронирования</h3>
      <MutationNotice {...mutation} />
      <AdminData result={result} retry={reload}>{(booking) => (
        <>
          <dl className="booking-detail-grid">
            <div><dt>Клиент</dt><dd>{booking.user.name}</dd></div>
            <div><dt>Дата и время</dt><dd>{formatBookingDate(booking.startsAt, timeZone)} · {formatBookingTime(booking.startsAt, timeZone)}–{formatBookingTime(booking.endsAt, timeZone)}</dd></div>
            <div><dt>Стол</dt><dd>{booking.table.label}</dd></div>
            <div><dt>Гостей</dt><dd>{booking.guestCount}</dd></div>
            <div><dt>Статус</dt><dd><Status status={booking.status} /></dd></div>
            <div><dt>Номер брони</dt><dd>{booking.id}</dd></div>
          </dl>
          <BookingChange booking={booking} mutation={mutation} path={path} />
        </>
      )}</AdminData>
    </section>
  );
}

function BookingChange({ booking, mutation, path }: {
  booking: Booking; mutation: ReturnType<typeof useAdminMutation>; path: string;
}) {
  const [target, setTarget] = useState("");
  const form = useRef<HTMLFormElement>(null);
  const options = adminBookingTransitions(booking, new Date());
  const chosen = options.find(({ status }) => status === target);

  if (!options.length) return <p className="workspace-muted">Смена статуса сейчас недоступна.</p>;

  function validate() {
    if (!chosen || !form.current) return false;
    const field = form.current.elements.namedItem("reason") as HTMLTextAreaElement;
    field.setCustomValidity(chosen.requiresReason && !field.value.trim() ? "Введите причину." : "");
    return form.current.reportValidity();
  }

  return (
    <form ref={form} className="workspace-stack admin-change" onSubmit={(event) => event.preventDefault()}>
      <label>Новый статус<select required value={chosen?.status ?? ""} disabled={mutation.pending}
        onChange={(event) => setTarget(event.target.value)}>
        <option value="">Выберите статус</option>
        {options.map(({ status }) => <option key={status} value={status}>{bookingStatusLabels[status]}</option>)}
      </select></label>
      {chosen && <>
        <label>Причина {chosen.requiresReason ? "(обязательно)" : "(необязательно)"}
          <textarea name="reason" required={chosen.requiresReason} aria-describedby="booking-reason-help" rows={3}
            onInput={(event) => event.currentTarget.setCustomValidity("")} disabled={mutation.pending} />
          <span className="workspace-muted" id="booking-reason-help">Не указывайте пароли, токены и другие секреты.</span>
        </label>
        <ConfirmDialog trigger="Изменить статус" title="Изменить статус бронирования?"
          description={`${booking.user.name} · ${booking.table.label}. ${bookingStatusLabels[booking.status]} → ${bookingStatusLabels[chosen.status]}.`}
          confirm="Изменить статус" pending={mutation.pending} danger={chosen.status === "cancelled"} beforeOpen={validate}
          onConfirm={() => {
            if (!form.current) return;
            const reason = new FormData(form.current).get("reason")?.toString().trim();
            void mutation.change(path, "PATCH", {
              expectedStatus: booking.status, status: chosen.status, ...(reason && { reason }),
            }, "Статус бронирования изменён.");
          }} />
      </>}
    </form>
  );
}
