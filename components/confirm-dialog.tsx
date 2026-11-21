"use client";

import { useId, useRef, type ReactNode } from "react";

export function ConfirmDialog({ trigger, triggerLabel, title, description, confirm, pending, onConfirm, beforeOpen, danger = false }: {
  trigger: string;
  triggerLabel?: string;
  beforeOpen?: () => boolean;
  title: string;
  description: string;
  confirm: string;
  pending: boolean;
  onConfirm: () => void;
  danger?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const dismiss = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  return (
    <>
      <button ref={opener} type="button" className={`button button-secondary${danger ? " button-danger" : ""}`}
        aria-label={triggerLabel} disabled={pending} onClick={() => {
          if (beforeOpen && !beforeOpen()) return;
          dialog.current?.showModal();
          dismiss.current?.focus();
        }}>
        {trigger}
      </button>
      <dialog ref={dialog} className="confirm-dialog" aria-labelledby={titleId} aria-describedby={descriptionId}
        onClose={() => opener.current?.focus()}>
        <h3 id={titleId}>{title}</h3>
        <p id={descriptionId}>{description}</p>
        <div className="confirm-actions">
          <button ref={dismiss} type="button" className="button button-secondary" onClick={() => dialog.current?.close()}>Назад</button>
          <button type="button" className="button" onClick={() => { dialog.current?.close(); onConfirm(); }}>
            {confirm}
          </button>
        </div>
      </dialog>
    </>
  );
}

export function ResultMessage({ error, children }: { error?: boolean; children: ReactNode }) {
  return <p className={error ? "guest-error workspace-message" : "workspace-message"} role={error ? "alert" : "status"}>{children}</p>;
}
