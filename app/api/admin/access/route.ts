import { checkAdminAccess } from "../../../../lib/auth/access";

export async function GET() {
  const access = await checkAdminAccess();
  const headers = { "Cache-Control": "private, no-store" };

  if (!access.allowed) {
    const error = access.status === 401 ? "Войдите в аккаунт." : "Доступ запрещён.";
    return Response.json({ error }, { status: access.status, headers });
  }

  return Response.json({ role: access.user.role }, { headers });
}
