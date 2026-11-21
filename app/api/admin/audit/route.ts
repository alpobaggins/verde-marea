import { listAdminAudit } from "../../../../lib/audit/admin";
import { checkAdminAccess } from "../../../../lib/auth/access";
import { accessDenied, reply } from "../response";

export async function GET(request: Request) {
  try {
    const access = await checkAdminAccess();
    if (!access.allowed) return accessDenied(access.status);
    const events = await listAdminAudit(access.user.role === "super_admin", new URL(request.url).searchParams);
    return events ? reply({ events }) : reply({ error: "Проверьте фильтры журнала." }, 400);
  } catch {
    return reply({ error: "Не удалось получить журнал аудита." }, 500);
  }
}
