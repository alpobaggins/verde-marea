"use client";

export default function AccountError({ reset }: { reset: () => void }) {
  return (
    <main className="guest-container workspace account-screen">
      <h1 className="guest-title">Личный кабинет</h1>
      <p role="alert">Не удалось загрузить кабинет.</p>
      <button className="button" type="button" onClick={reset}>Повторить</button>
    </main>
  );
}
