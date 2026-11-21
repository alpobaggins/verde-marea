"use client";

import type { Role } from "../../prisma/generated/client/enums";
import { ConfirmDialog } from "../../components/confirm-dialog";
import { AdminData, AdminTable, MutationNotice, useAdminData, useAdminMutation } from "./workspace";

import { roleLabels } from "./labels";

const path = "/api/admin/users";
type User = { id: string; name: string; email: string; role: Role; roleVersion?: number };

export function AdminUsers({ superAdmin }: { superAdmin: boolean }) {
  const { result, reload } = useAdminData<{ users: User[] }>(path);
  const mutation = useAdminMutation(reload);

  return (
    <>
      <p className="workspace-muted">{superAdmin ? "Назначение и отзыв роли администратора." : "Аккаунты гостей ресторана."}</p>
      <MutationNotice {...mutation} />
      <AdminData result={result} retry={reload}>{({ users }) => users.length ? (
        <AdminTable label="Пользователи" headings={["Имя", "Email", "Роль", ...(superAdmin ? ["Действие"] : [])]}>
          {users.map(({ id, name, email, role, roleVersion }) => {
            const target = role === "user" ? "admin" : "user";
            const action = target === "admin" ? "Назначить администратором" : "Отозвать роль администратора";
            return (
              <tr key={id}>
                <td>{name}</td><td>{email}</td><td>{roleLabels[role]}</td>
                {superAdmin && <td>{role !== "super_admin" && roleVersion !== undefined ? (
                  <ConfirmDialog trigger={action} triggerLabel={`${action}: ${email}`} title="Изменить роль?"
                    description={`${name} · ${email}. ${roleLabels[role]} → ${roleLabels[target]}.`}
                    confirm={action} pending={mutation.pending} danger={target === "user"}
                    onConfirm={() => void mutation.change(`${path}/${id}/role`, "PATCH", {
                      expectedRole: role, expectedVersion: roleVersion, role: target,
                    }, "Роль пользователя изменена.")} />
                ) : "—"}</td>}
              </tr>
            );
          })}
        </AdminTable>
      ) : <p className="workspace-muted">Пользователей пока нет.</p>}</AdminData>
    </>
  );
}
