"use client";

import { useRef, useState } from "react";
import { ConfirmDialog } from "../../components/confirm-dialog";
import { restaurantWindowStarts } from "../../lib/booking/calendar";
import { formatBookingDate, formatBookingTime } from "../../lib/booking/display";
import { AdminData, AdminTable, MutationNotice, useAdminData, useAdminMutation } from "./workspace";

const closuresPath = "/api/admin/availability/closures";
const tablesPath = "/api/admin/availability/tables";
type Closure = { id: string; kind: "day" | "window"; startsAt: string; endsAt: string };
type Table = { id: string; label: string; capacity: number; isAvailable: boolean };

export function AdminAvailability({ timeZone }: { timeZone: string }) {
  const closures = useAdminData<{ closures: Closure[] }>(closuresPath);
  const tables = useAdminData<{ tables: Table[] }>(tablesPath);
  const closureMutation = useAdminMutation(closures.reload);
  const tableMutation = useAdminMutation(tables.reload);

  return (
    <>
      <section className="workspace-panel workspace-stack" aria-labelledby="closure-heading">
        <div>
          <h3 id="closure-heading">Закрытия</h3>
          <p className="workspace-muted">Базовый график: вторник–воскресенье, 12:00–21:00. Окно длится 90 минут.</p>
        </div>
        <ClosureForm mutation={closureMutation} unavailable={!closures.result || !("data" in closures.result)} />
        <MutationNotice {...closureMutation} />
        <AdminData result={closures.result} retry={closures.reload}>{({ closures }) => closures.length ? (
          <AdminTable label="Закрытия" headings={["Дата", "Период", "Действие"]}>
            {closures.map(({ id, kind, startsAt, endsAt }) => {
              const date = formatBookingDate(startsAt, timeZone);
              const period = kind === "day" ? "Весь день"
                : `${formatBookingTime(startsAt, timeZone)}–${formatBookingTime(endsAt, timeZone)}`;
              return <tr key={id}>
                <td>{date}</td><td>{period}</td>
                <td><ConfirmDialog trigger="Снять закрытие" triggerLabel={`Снять закрытие: ${date} · ${period}`} title="Снять закрытие?"
                  description={`${date} · ${period}`} confirm="Снять закрытие" pending={closureMutation.pending}
                  onConfirm={() => void closureMutation.change(`${closuresPath}/${id}`, "DELETE",
                    { kind, startsAt, endsAt }, "Закрытие снято.")} /></td>
              </tr>;
            })}
          </AdminTable>
        ) : <p className="workspace-muted">Закрытий пока нет.</p>}</AdminData>
      </section>
      <section className="workspace-stack" aria-labelledby="tables-heading">
        <h3 id="tables-heading">Столы</h3>
        <MutationNotice {...tableMutation} />
        <AdminData result={tables.result} retry={tables.reload}>{({ tables }) => tables.length ? (
          <AdminTable label="Доступность столов" headings={["Стол", "Мест", "Доступность", "Действие"]}>
            {tables.map(({ id, label, capacity, isAvailable }) => {
              const action = isAvailable ? "Отключить стол" : "Включить стол";
              return <tr key={id}>
                <td>{label}</td><td>{capacity}</td><td>{isAvailable ? "Доступен" : "Отключён"}</td>
                <td><ConfirmDialog trigger={action} triggerLabel={`${action}: ${label}`} title={`${action}?`}
                  description={`${label} · мест: ${capacity}`} confirm={action} danger={isAvailable} pending={tableMutation.pending}
                  onConfirm={() => void tableMutation.change(`${tablesPath}/${id}`, "PATCH",
                    { isAvailable: !isAvailable }, isAvailable ? "Стол отключён." : "Стол включён.")} /></td>
              </tr>;
            })}
          </AdminTable>
        ) : <p className="workspace-muted">Столов пока нет.</p>}</AdminData>
      </section>
    </>
  );
}

function ClosureForm({ mutation, unavailable }: { mutation: ReturnType<typeof useAdminMutation>; unavailable: boolean }) {
  const [kind, setKind] = useState<Closure["kind"]>("day");
  const [date, setDate] = useState("");
  const [start, setStart] = useState<string>(restaurantWindowStarts[0]);
  const form = useRef<HTMLFormElement>(null);
  const disabled = mutation.pending || unavailable;

  return (
    <form ref={form} className="admin-filters" onSubmit={(event) => event.preventDefault()}>
      <label>Дата<input required type="date" name="date" value={date}
        onChange={(event) => setDate(event.target.value)} disabled={disabled} /></label>
      <label>Период<select value={kind} onChange={(event) => setKind(event.target.value as Closure["kind"])}
        disabled={disabled}>
        <option value="day">Весь день</option><option value="window">Одно окно</option>
      </select></label>
      {kind === "window" && <label>Начало окна<select name="start" value={start}
        onChange={(event) => setStart(event.target.value)} disabled={disabled}>
        {restaurantWindowStarts.map((start) => <option key={start} value={start}>{start}</option>)}
      </select></label>}
      <ConfirmDialog trigger="Добавить закрытие" title="Закрыть бронирование?"
        description={`${date.split("-").reverse().join(".")} · ${kind === "day" ? "весь день" : `окно с ${start}`}`}
        confirm="Добавить закрытие" danger pending={disabled} beforeOpen={() => form.current?.reportValidity() ?? false}
        onConfirm={() => void mutation.change(closuresPath, "POST", {
          kind, date, ...(kind === "window" && { start }),
        }, "Закрытие добавлено.")} />
    </form>
  );
}
