export function reply(body: object, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

export function accessDenied(status: 401 | 403) {
  return reply({ error: status === 401 ? "Войдите в аккаунт." : "Доступ запрещён." }, status);
}
