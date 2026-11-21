import "server-only";

import { getPrisma } from "../db";

export function readAccountNotifications(recipientId: string) {
  return getPrisma().notification.findMany({
    where: { recipientId },
    select: { id: true, status: true, createdAt: true, readAt: true },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
  });
}

export async function markNotificationRead(recipientId: string, id: string) {
  const prisma = getPrisma();
  const updated = await prisma.notification.updateMany({
    where: { id, recipientId, readAt: null },
    data: { readAt: new Date() },
  });
  if (updated.count === 1) return true;

  const existing = await prisma.notification.findFirst({
    where: { id, recipientId },
    select: { id: true },
  });
  return existing !== null;
}
