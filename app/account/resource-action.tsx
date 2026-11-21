"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { apiError } from "../booking/http-error";

const actions = {
  cancel: { label: "Отменить бронь", pending: "Отменяем…", path: "bookings", suffix: "cancel" },
  read: { label: "Отметить прочитанным", pending: "Сохраняем…", path: "notifications", suffix: "read" },
};

export function ResourceAction({ id, kind }: { id: string; kind: keyof typeof actions }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const action = actions[kind];

  function submit() {
    if (kind === "cancel" && !window.confirm("Отменить это бронирование?")) return;
    setError("");
    startTransition(async () => {
      try {
        const response = await fetch(`/api/${action.path}/${id}/${action.suffix}`, { method: "PATCH" });
        if (!response.ok) {
          setError(await apiError(response, "Не удалось выполнить действие. Попробуйте ещё раз."));
          return;
        }
        router.refresh();
      } catch {
        setError("Не удалось получить результат. Обновите страницу перед повторной отправкой.");
      }
    });
  }

  return (
    <div className="auth-form">
      <button type="button" disabled={pending} onClick={submit}>{pending ? action.pending : action.label}</button>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
