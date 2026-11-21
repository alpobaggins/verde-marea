import { z } from "zod";
import { currentUser } from "../../../../../lib/auth/session";
import { markNotificationRead } from "../../../../../lib/notifications/service";

const headers = { "Cache-Control": "private, no-store" };

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await currentUser();
    if (!user) return Response.json({ error: "Войдите в аккаунт." }, { status: 401, headers });

    const { id } = await params;
    if (!z.uuid().safeParse(id).success || new URL(request.url).search || await request.text()) {
      return Response.json({ error: "Укажите корректный идентификатор уведомления." }, { status: 400, headers });
    }
    if (!await markNotificationRead(user.id, id)) {
      return Response.json({ error: "Уведомление не найдено." }, { status: 404, headers });
    }
    return new Response(null, { status: 204, headers });
  } catch (error) {
    console.error("Notification read update failed", error);
    return Response.json({ error: "Не удалось отметить уведомление прочитанным." }, { status: 500, headers });
  }
}
