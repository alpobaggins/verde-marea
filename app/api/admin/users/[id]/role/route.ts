import { changeAdminUserRole } from "../../../../../../lib/auth/admin-users";
import { currentSessionToken } from "../../../../../../lib/auth/session";
import { accessDenied, reply } from "../../../response";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const token = await currentSessionToken();
    if (!token) return accessDenied(401);
    const mediaType = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
    const input = mediaType === "application/json" && !new URL(request.url).search
      ? await request.json().catch(() => undefined)
      : undefined;
    const result = await changeAdminUserRole(token, (await params).id, input);

    switch (result.status) {
      case "ok":
        return reply(result.user);
      case "unauthorized":
        return accessDenied(401);
      case "forbidden":
        return accessDenied(403);
      case "invalid_input":
        return reply({ error: "Проверьте идентификатор и выбранные роли." }, 400);
      case "not_found":
        return reply({ error: "Пользователь не найден." }, 404);
      case "concurrent_change":
        return reply({ error: "Роль изменилась. Обновите данные." }, 409);
    }
  } catch {
    return reply({ error: "Не удалось изменить роль." }, 500);
  }
}
