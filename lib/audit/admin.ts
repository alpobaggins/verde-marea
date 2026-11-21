import { z } from "zod";
import { AuditAction, AuditTarget, BookingStatus, ClosureKind, Role } from "../../prisma/generated/client/enums";
import type { Prisma } from "../../prisma/generated/client/client";
import { getPrisma } from "../db";

const filters = z.strictObject({
  action: z.enum(AuditAction).optional(),
  targetType: z.enum(AuditTarget).optional(),
  limit: z.string().regex(/^[1-9]\d{0,2}$/).transform(Number).pipe(z.number().max(100)).optional(),
});
const adminActions = [
  "booking_created", "booking_status_changed", "availability_closed", "availability_reopened",
  "table_availability_changed",
] satisfies AuditAction[];

const snapshots = {
  booking_created: z.object({
    tableId: z.uuid().optional(),
    startsAt: z.iso.datetime().optional(),
    endsAt: z.iso.datetime().optional(),
    guestCount: z.number().int().positive().optional(),
    status: z.enum(BookingStatus).optional(),
  }),
  booking_status_changed: z.object({ status: z.enum(BookingStatus).optional() }),
  availability_closed: z.object({
    kind: z.enum(ClosureKind).optional(),
    startsAt: z.iso.datetime().optional(),
    endsAt: z.iso.datetime().optional(),
  }),
  availability_reopened: z.object({
    kind: z.enum(ClosureKind).optional(),
    startsAt: z.iso.datetime().optional(),
    endsAt: z.iso.datetime().optional(),
  }),
  table_availability_changed: z.object({ isAvailable: z.boolean().optional() }),
  user_role_changed: z.object({ role: z.enum(Role).optional() }),
} satisfies Record<AuditAction, z.ZodType>;

function safeSnapshot(action: AuditAction, value: Prisma.JsonValue) {
  const parsed = snapshots[action].safeParse(value);
  return parsed.success && Object.keys(parsed.data).length ? parsed.data : null;
}

export async function listAdminAudit(superAdmin: boolean, params: URLSearchParams) {
  if (new Set(params.keys()).size !== params.size) return null;
  const parsed = filters.safeParse(Object.fromEntries(params));
  if (!parsed.success) return null;
  const { action, targetType, limit = 50 } = parsed.data;
  const events = await getPrisma().auditLog.findMany({
    where: {
      action,
      targetType,
      AND: superAdmin ? undefined : {
        action: { in: adminActions },
        targetType: { in: ["booking", "availability_closure", "table"] },
      },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit,
    select: {
      id: true, createdAt: true, action: true, targetType: true, targetId: true,
      actorRole: true, before: true, after: true, reason: true,
      actor: { select: { id: true, name: true, role: true } },
    },
  });

  return events.map(({ actor, actorRole, before, after, reason, ...event }) => ({
    ...event,
    actorRole,
    actor: superAdmin || (actorRole === "user" && actor.role === "user")
      ? { id: actor.id, name: actor.name }
      : null,
    before: safeSnapshot(event.action, before),
    after: safeSnapshot(event.action, after),
    ...(superAdmin ? { reason } : { hasReason: reason !== null }),
  }));
}
