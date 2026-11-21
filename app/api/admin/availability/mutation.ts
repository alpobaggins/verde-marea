import { currentSessionToken } from "../../../../lib/auth/session";
import { changeAdminAvailability } from "../../../../lib/booking/admin-availability";
import { accessDenied, reply } from "../response";

type Operation = { action: "close" } | { action: "reopen" | "table"; id: string };
export type Context = { params: Promise<{ id: string }> };

export async function mutateAvailability(request: Request, operation: Operation) {
  try {
    const token = await currentSessionToken();
    if (!token) return accessDenied(401);
    const mediaType = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
    const input = mediaType === "application/json" && !new URL(request.url).search
      ? await request.json().catch(() => undefined)
      : undefined;
    const result = await changeAdminAvailability(token, { ...operation, input });

    switch (result.status) {
      case "created":
        return reply(result.closure, 201);
      case "updated":
        return reply(result.table);
      case "removed":
        return new Response(null, { status: 204, headers: { "Cache-Control": "private, no-store" } });
      case "unauthorized":
        return accessDenied(401);
      case "forbidden":
        return accessDenied(403);
      case "invalid_input":
        return reply({ error: "Проверьте параметры операции." }, 400);
      case "not_found":
        return reply({ error: "Стол не найден." }, 404);
      case "booking_conflict":
        return reply({ error: "Операция затрагивает активное будущее бронирование." }, 409);
      case "duplicate":
        return reply({ error: "Такое закрытие уже существует." }, 409);
      case "concurrent_change":
        return reply({ error: "Обновите данные о доступности перед повтором." }, 409);
    }
  } catch (error) {
    console.error("Administrative availability change failed", error);
    return reply({ error: "Не удалось изменить доступность." }, 500);
  }
}
