import { currentSessionToken } from "../../../lib/auth/session";
import { createBooking } from "../../../lib/booking/create";

function reply(body: object, status: number) {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request) {
  const unauthorized = { error: "Войдите в аккаунт." };
  const invalid = { error: "Укажите дату, начало окна в UTC и положительное целое число гостей." };

  try {
    const token = await currentSessionToken();
    if (!token) return reply(unauthorized, 401);

    const mediaType = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
    const body: unknown = mediaType === "application/json"
      ? await request.json().catch(() => undefined)
      : undefined;
    const result = await createBooking(token, body);
    switch (result.status) {
      case "created":
        return reply(result.booking, 201);
      case "invalid_input":
        return reply(invalid, 400);
      case "unauthorized":
        return reply(unauthorized, 401);
      case "unavailable":
        return reply({ error: "Выбранное окно больше недоступно." }, 409);
      case "concurrent_change":
        return reply({ error: "Доступность изменилась. Обновите список окон." }, 409);
    }
  } catch (error) {
    console.error("Booking creation failed", error);
    return reply({ error: "Не удалось создать бронирование." }, 500);
  }
}
