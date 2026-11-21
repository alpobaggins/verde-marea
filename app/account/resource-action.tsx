"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ConfirmDialog, ResultMessage } from "../../components/confirm-dialog";
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
    <div className="account-action">
      {kind === "cancel" ? (
        <ConfirmDialog trigger={pending ? action.pending : action.label} title="Отменить бронирование?"
          description="Бронь останется в истории со статусом «Отменена»." confirm="Отменить бронь"
          pending={pending} onConfirm={submit} danger />
      ) : (
        <button className="button button-secondary" type="button" disabled={pending} onClick={submit}>
          {pending ? action.pending : action.label}
        </button>
      )}
      {pending && <p className="sr-only" role="status">{action.pending}</p>}
      {error && <ResultMessage error>{error}</ResultMessage>}
    </div>
  );
}
