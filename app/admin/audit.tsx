"use client";

import { useState } from "react";
import type { AuditAction, AuditTarget, Role } from "../../prisma/generated/client/enums";
import { bookingStatusLabels, formatBookingDate, formatBookingTime } from "../../lib/booking/display";
import { roleLabels } from "./labels";
import { AdminData, AdminTable, filterQuery, useAdminData } from "./workspace";

const actions: Record<AuditAction, string> = {
  booking_created: "Создана бронь",
  booking_status_changed: "Изменён статус брони",
  availability_closed: "Добавлено закрытие",
  availability_reopened: "Снято закрытие",
  table_availability_changed: "Изменена доступность стола",
  user_role_changed: "Изменена роль",
};

const objects: Record<AuditTarget, string> = {
  booking: "Бронирование", availability_closure: "Закрытие", table: "Стол", user: "Пользователь",
};

type Snapshot = Partial<{
  status: keyof typeof bookingStatusLabels; role: Role; kind: "day" | "window";
  startsAt: string; endsAt: string; guestCount: number; tableId: string; isAvailable: boolean;
}>;

type AuditEvent = {
  id: string; createdAt: string; actorRole: Role; actor: { id: string; name: string } | null;
  action: AuditAction; targetType: AuditTarget; targetId: string; before: Snapshot | null; after: Snapshot | null;
  reason?: string | null; hasReason?: boolean;
};

function SnapshotFields({ snapshot, timeZone }: { snapshot: Snapshot | null; timeZone: string }) {
  if (!snapshot) return <p>—</p>;
  const { status, role, kind, startsAt, endsAt, guestCount, tableId, isAvailable } = snapshot;
  return (
    <dl>
      {status && <div><dt>Статус</dt><dd>{bookingStatusLabels[status]}</dd></div>}
      {role && <div><dt>Роль</dt><dd>{roleLabels[role]}</dd></div>}
      {kind && <div><dt>Период</dt><dd>{kind === "day" ? "Весь день" : "Одно окно"}</dd></div>}
      {startsAt && <div><dt>Начало</dt><dd>{formatBookingDate(startsAt, timeZone)} · {formatBookingTime(startsAt, timeZone)}</dd></div>}
      {endsAt && <div><dt>Конец</dt><dd>{formatBookingDate(endsAt, timeZone)} · {formatBookingTime(endsAt, timeZone)}</dd></div>}
      {guestCount !== undefined && <div><dt>Гостей</dt><dd>{guestCount}</dd></div>}
      {tableId && <div><dt>Номер стола</dt><dd>{tableId}</dd></div>}
      {isAvailable !== undefined && <div><dt>Доступность</dt><dd>{isAvailable ? "Доступен" : "Отключён"}</dd></div>}
    </dl>
  );
}

export function AdminAudit({ superAdmin, timeZone }: { superAdmin: boolean; timeZone: string }) {
  const [query, setQuery] = useState("");
  const { result, reload } = useAdminData<{ events: AuditEvent[] }>(`/api/admin/audit${query ? `?${query}` : ""}`);

  return (
    <>
      <p className="workspace-muted">Сначала новые события.</p>
      <form className="admin-filters" onSubmit={(event) => { event.preventDefault(); setQuery(filterQuery(event.currentTarget)); }}
        onReset={() => setQuery("")}>
        <label>Действие<select name="action">
          <option value="">Все действия</option>
          {Object.entries(actions).filter(([value]) => superAdmin || value !== "user_role_changed")
            .map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
        <label>Объект<select name="targetType">
          <option value="">Все объекты</option>
          {Object.entries(objects).filter(([value]) => superAdmin || value !== "user")
            .map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
        <label>Лимит<input name="limit" type="number" min={1} max={100} step={1} placeholder="50" /></label>
        <button className="button" type="submit">Применить</button>
        <button className="button button-secondary" type="reset">Сбросить</button>
      </form>
      <AdminData result={result} retry={reload}>{({ events }) => events.length ? (
        <AdminTable label="События аудита" headings={["Дата и время", "Исполнитель", "Действие", "Объект и изменения"]}>
          {events.map((event) => <tr key={event.id}>
            <td><time dateTime={event.createdAt}>{formatBookingDate(event.createdAt, timeZone)} · {formatBookingTime(event.createdAt, timeZone)}</time></td>
            <td>{event.actor ? <>{event.actor.name}<br /><span className="workspace-muted">{roleLabels[event.actorRole]}</span></> : "Скрыт"}</td>
            <td>{actions[event.action]}</td>
            <td><details className="audit-details">
              <summary>{objects[event.targetType]}</summary>
              <p className="workspace-muted">Номер объекта: {event.targetId}</p>
              <div className="audit-snapshots">
                <div><strong>До</strong><SnapshotFields snapshot={event.before} timeZone={timeZone} /></div>
                <div><strong>После</strong><SnapshotFields snapshot={event.after} timeZone={timeZone} /></div>
              </div>
              {superAdmin && event.reason && <p><strong>Причина:</strong> {event.reason}</p>}
              {!superAdmin && event.hasReason && <p>Причина указана.</p>}
            </details></td>
          </tr>)}
        </AdminTable>
      ) : <p className="workspace-muted">{query ? "По этим фильтрам событий нет." : "Событий пока нет."}</p>}</AdminData>
    </>
  );
}
