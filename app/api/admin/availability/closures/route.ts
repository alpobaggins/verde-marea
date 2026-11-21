import { checkAdminAccess } from "../../../../../lib/auth/access";
import { listClosures } from "../../../../../lib/booking/admin-availability";
import { accessDenied, reply } from "../../response";
import { mutateAvailability } from "../mutation";

export async function GET() {
  const access = await checkAdminAccess();
  if (!access.allowed) return accessDenied(access.status);
  return reply({ closures: await listClosures() });
}

export function POST(request: Request) {
  return mutateAvailability(request, { action: "close" });
}
