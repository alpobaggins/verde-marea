import { checkAdminAccess } from "../../../../../lib/auth/access";
import { listTables } from "../../../../../lib/booking/admin-availability";
import { accessDenied, reply } from "../../response";

export async function GET() {
  const access = await checkAdminAccess();
  if (!access.allowed) return accessDenied(access.status);
  return reply({ tables: await listTables() });
}
