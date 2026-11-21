import type { Role } from "../../prisma/generated/client/enums";

export function canAccessAdministration(role: Role) {
  return role === "admin" || role === "super_admin";
}

type AccountRole = { id: string; role: Role };

export function canChangeAccountRole(actor: AccountRole, target: AccountRole, newRole: Role) {
  return actor.role === "super_admin"
    && actor.id !== target.id
    && (
      (target.role === "user" && newRole === "admin")
      || (target.role === "admin" && newRole === "user")
    );
}
