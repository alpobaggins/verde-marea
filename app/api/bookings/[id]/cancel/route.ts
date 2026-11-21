import { currentSessionToken } from "../../../../../lib/auth/session";
import { cancelBooking } from "../../../../../lib/booking/cancel";

function reply(body: object, status: number) {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const token = await currentSessionToken();
    if (!token) return reply({ error: "Войдите в аккаунт." }, 401);

    const { id } = await params;
    const mediaType = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
    const input = mediaType === "application/json" && !new URL(request.url).search
      ? await request.json().catch(() => undefined)
      : undefined;
    const result = await cancelBooking(token, id, input);

    switch (result.status) {
      case "cancelled":
        return reply(result.booking, 200);
      case "invalid_input":
        return reply({ error: "Укажите корректный идентификатор и ожидаемый статус бронирования." }, 400);
      case "invalid_transition":
        return reply({ error: "Текущий статус бронирования не допускает отмену." }, 400);
      case "too_late":
        return reply({ error: "Отменить бронирование можно не позднее чем за три часа до начала." }, 400);
      case "unauthorized":
        return reply({ error: "Войдите в аккаунт." }, 401);
      case "not_found":
        return reply({ error: "Бронирование не найдено." }, 404);
      case "concurrent_change":
        return reply({ error: "Состояние бронирования изменилось. Проверьте актуальные данные." }, 409);
    }
  } catch (error) {
    console.error("Booking cancellation failed", error);
    return reply({ error: "Не удалось отменить бронирование." }, 500);
  }
}
