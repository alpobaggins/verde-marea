import { checkAdminAccess } from "../../../../../lib/auth/access";
import { currentSessionToken } from "../../../../../lib/auth/session";
import { changeAdminBookingStatus, findAdminBooking } from "../../../../../lib/booking/admin";
import { accessDenied, reply } from "../../response";

type Context = { params: Promise<{ id: string }> };

function notFound() {
  return reply({ error: "Бронирование не найдено." }, 404);
}

export async function GET(_request: Request, { params }: Context) {
  const access = await checkAdminAccess();
  if (!access.allowed) return accessDenied(access.status);

  const result = await findAdminBooking((await params).id);
  switch (result.status) {
    case "ok":
      return reply(result.booking);
    case "invalid_input":
      return reply({ error: "Укажите корректный идентификатор бронирования." }, 400);
    case "not_found":
      return notFound();
  }
}

export async function PATCH(request: Request, { params }: Context) {
  try {
    const token = await currentSessionToken();
    if (!token) return accessDenied(401);

    const mediaType = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
    const input = mediaType === "application/json" && !new URL(request.url).search
      ? await request.json().catch(() => undefined)
      : undefined;
    const result = await changeAdminBookingStatus(token, (await params).id, input);

    switch (result.status) {
      case "ok":
        return reply(result.booking);
      case "unauthorized":
        return accessDenied(401);
      case "forbidden":
        return accessDenied(403);
      case "invalid_input":
        return reply({ error: "Проверьте идентификатор и поля запроса." }, 400);
      case "invalid_transition":
        return reply({ error: "Переход недоступен. Проверьте статус, время и причину." }, 400);
      case "not_found":
        return notFound();
      case "concurrent_change":
        return reply({ error: "Бронирование изменилось. Обновите данные." }, 409);
    }
  } catch (error) {
    console.error("Administrative booking status change failed", error);
    return reply({ error: "Не удалось изменить статус бронирования." }, 500);
  }
}
