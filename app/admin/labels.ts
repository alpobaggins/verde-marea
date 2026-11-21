import type { Role } from "../../prisma/generated/client/enums";

export const roleLabels: Record<Role, string> = {
  user: "Пользователь", admin: "Администратор", super_admin: "Руководитель",
};
