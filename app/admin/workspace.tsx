"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { apiError } from "../booking/http-error";
import { ResultMessage } from "../../components/confirm-dialog";

type Load<T> = { data: T } | { error: string; status?: number };

export function useAdminData<T>(path: string) {
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ key: string; value: Load<T> }>();
  const key = `${revision}:${path}`;

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      let value: Load<T>;
      try {
        const response = await fetch(path, { signal: controller.signal, cache: "no-store" });
        value = response.ok
          ? { data: await response.json() as T }
          : { error: await apiError(response, "Не удалось загрузить данные."), status: response.status };
      } catch {
        value = { error: "Не удалось загрузить данные. Проверьте соединение." };
      }
      if (!controller.signal.aborted) setResult({ key, value });
    }
    void load();
    return () => controller.abort();
  }, [key, path]);

  return { result: result?.key === key ? result.value : undefined, reload: () => setRevision((value) => value + 1) };
}

export function AdminData<T>({ result, retry, children }: {
  result: Load<T> | undefined; retry: () => void; children: (data: T) => ReactNode;
}) {
  if (!result) return <p className="workspace-muted" role="status">Загружаем данные…</p>;
  if ("data" in result) return children(result.data);
  return (
    <div className="workspace-stack">
      <ResultMessage error>{result.error}</ResultMessage>
      {result.status === 401 ? <Link className="workspace-link" href="/login">Войти</Link>
        : result.status !== 403 && <button className="button button-secondary" onClick={retry}>Повторить</button>}
    </div>
  );
}

export function useAdminMutation(reload: () => void) {
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error?: boolean }>();

  async function change(path: string, method: "PATCH" | "POST" | "DELETE", body: object, success: string) {
    if (inFlight.current) return false;
    inFlight.current = true;
    setPending(true);
    setNotice(undefined);
    try {
      const response = await fetch(path, {
        method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      if (response.ok) {
        setNotice({ text: success });
        reload();
        return true;
      }
      const message = await apiError(response, "Не удалось сохранить изменения.");
      const conflict = response.status === 409;
      setNotice({ error: true, text: conflict ? `${message} Загружаем актуальные данные.` : message });
      if (conflict || [401, 403, 404].includes(response.status)) reload();
    } catch {
      setNotice({ error: true, text: "Не удалось получить результат. Загружаем актуальные данные перед повтором." });
      reload();
    } finally {
      inFlight.current = false;
      setPending(false);
    }
    return false;
  }

  return { pending, notice, change };
}

export function MutationNotice({ pending, notice }: Pick<ReturnType<typeof useAdminMutation>, "pending" | "notice">) {
  if (pending) return <p role="status">Сохраняем изменения…</p>;
  return notice && <ResultMessage error={notice.error}>{notice.text}</ResultMessage>;
}

export function AdminTable({ label, headings, children }: { label: string; headings: string[]; children: ReactNode }) {
  return (
    <div className="admin-table-scroll" role="region" aria-label={label} tabIndex={0}>
      <table className="admin-table">
        <thead><tr>{headings.map((heading) => <th key={heading} scope="col">{heading}</th>)}</tr></thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function filterQuery(form: HTMLFormElement) {
  const query = new URLSearchParams();
  for (const [key, value] of new FormData(form)) {
    if (typeof value === "string" && value) query.set(key, value);
  }
  return query.toString();
}
