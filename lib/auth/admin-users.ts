import { z } from "zod";
import { getPrisma } from "../db";
import { bookingTransaction } from "../booking/transaction";
import { canChangeAccountRole } from "./permissions";
import { findSessionUser } from "./service";

const userFields = { id: true, name: true, email: true, role: true } as const;
const editableRole = z.enum(["user", "admin"]);
const roleChange = z.strictObject({
  expectedRole: editableRole,
  expectedVersion: z.number().int().nonnegative(),
  role: editableRole,
});
const roleAudit = { action: "user_role_changed", targetType: "user" } as const;
const userId = z.uuid();

export async function listAdminUsers(role: "admin" | "super_admin") {
  const orderBy = [{ name: "asc" }, { id: "asc" }] as const;
  const prisma = getPrisma();
  if (role === "admin") {
    return prisma.user.findMany({ where: { role: "user" }, select: userFields, orderBy: [...orderBy] });
  }
  return prisma.$transaction(async (tx) => {
    const users = await tx.user.findMany({ select: userFields, orderBy: [...orderBy] });
    const counts = await tx.auditLog.groupBy({
      by: ["targetId"], where: roleAudit, _count: { _all: true },
    });
    const versions = new Map(counts.map(({ targetId, _count }) => [targetId, _count._all]));
    return users.map((user) => ({ ...user, roleVersion: versions.get(user.id) ?? 0 }));
  }, { isolationLevel: "RepeatableRead" });
}

export async function changeAdminUserRole(token: string | undefined, id: string, input: unknown) {
  if (!token) return { status: "unauthorized" } as const;

  return bookingTransaction(async (tx) => {
    const actor = await findSessionUser(token, tx);
    if (!actor) return { status: "unauthorized" } as const;
    if (actor.role !== "super_admin") return { status: "forbidden" } as const;

    const parsed = roleChange.safeParse(input);
    if (!userId.safeParse(id).success || !parsed.success) return { status: "invalid_input" } as const;
    const { expectedRole, expectedVersion, role } = parsed.data;
    const target = await tx.user.findUnique({ where: { id }, select: userFields });
    if (!target) return { status: "not_found" } as const;
    if (actor.id === target.id || target.role === "super_admin") return { status: "forbidden" } as const;
    if (target.role !== expectedRole) return { status: "concurrent_change" } as const;
    // The append-only role history distinguishes a role from the same value after a round trip.
    const currentVersion = await tx.auditLog.count({ where: { ...roleAudit, targetId: id } });
    if (currentVersion !== expectedVersion) return { status: "concurrent_change" } as const;
    if (!canChangeAccountRole(actor, target, role)) return { status: "invalid_input" } as const;

    const update = await tx.user.updateMany({ where: { id, role: expectedRole }, data: { role } });
    if (update.count !== 1) return { status: "concurrent_change" } as const;
    await tx.auditLog.create({
      data: {
        actorId: actor.id, actorRole: actor.role, ...roleAudit, targetId: id, before: { role: expectedRole }, after: { role },
      },
    });
    return { status: "ok", user: { ...target, role, roleVersion: currentVersion + 1 } } as const;
  });
}
