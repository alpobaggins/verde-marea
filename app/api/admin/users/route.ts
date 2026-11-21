import { checkAdminAccess } from "../../../../lib/auth/access";
import { listAdminUsers } from "../../../../lib/auth/admin-users";
import { accessDenied, reply } from "../response";

export async function GET() {
  try {
    const access = await checkAdminAccess();
    if (!access.allowed) return accessDenied(access.status);
    return reply({ users: await listAdminUsers(access.user.role === "super_admin" ? "super_admin" : "admin") });
  } catch {
    return reply({ error: "Не удалось получить список пользователей." }, 500);
  }
}
