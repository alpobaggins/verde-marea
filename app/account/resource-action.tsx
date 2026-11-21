"use client";

import { useRouter } from "next/navigation";
import { createContext, useContext, useState, useTransition, type ReactNode } from "react";
import { ConfirmDialog, ResultMessage } from "../../components/confirm-dialog";
import type { BookingStatus } from "../../prisma/generated/client/enums";
import { apiError } from "../booking/http-error";

const actions = {
  cancel: { label: "Отменить бронь", pending: "Отменяем…", path: "bookings", suffix: "cancel" },
  read: { label: "Отметить прочитанным", pending: "Сохраняем…", path: "notifications", suffix: "read" },
};

type ResourceActionProps = { id: string } & (
  { kind: "cancel"; expectedStatus: BookingStatus } | { kind: "read" }
);

const CancellationConflict = createContext<((message: string) => void) | null>(null);

export function BookingCancellationFeedback({ children }: { children: ReactNode }) {
  const [conflict, setConflict] = useState("");

  return (
    <CancellationConflict value={setConflict}>
      {conflict && <ResultMessage error>{conflict}</ResultMessage>}
      {children}
    </CancellationConflict>
  );
}

export function ResourceAction(props: ResourceActionProps) {
  const { id, kind } = props;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const setConflict = useContext(CancellationConflict);
  const action = actions[kind];

  function submit() {
    setError("");
    const options: RequestInit = { method: "PATCH" };
    if (props.kind === "cancel") {
      setConflict?.("");
      options.headers = { "Content-Type": "application/json" };
      options.body = JSON.stringify({ expectedStatus: props.expectedStatus });
    }

    startTransition(async () => {
      try {
        const response = await fetch(`/api/${action.path}/${id}/${action.suffix}`, options);
        if (!response.ok) {
          if (kind === "cancel" && response.status === 409) {
            const message = await apiError(response, "Состояние бронирования изменилось.");
            (setConflict ?? setError)(message);
            router.refresh();
          } else {
            setError(await apiError(response, "Не удалось выполнить действие. Попробуйте ещё раз."));
          }
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
