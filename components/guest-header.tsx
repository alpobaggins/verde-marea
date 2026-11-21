"use client";

import Link, { useLinkStatus } from "next/link";
import { useState } from "react";

function AccountLinkLabel() {
  const { pending } = useLinkStatus();
  return pending ? <span role="status">Загружаем кабинет…</span> : "Личный кабинет";
}

export function GuestHeader({ page }: { page?: "home" | "booking" | "account" }) {
  const [open, setOpen] = useState(false);

  return (
    <header className="guest-header">
      <div className="guest-container guest-header-inner">
        <Link className="wordmark" href="/" aria-current={page === "home" ? "page" : undefined}>
          Verde Marea
        </Link>
        <button
          type="button"
          className="button button-secondary guest-menu-toggle"
          aria-expanded={open}
          aria-controls="guest-navigation"
          onClick={() => setOpen(!open)}
        >
          Меню
        </button>
        <nav id="guest-navigation" className="guest-navigation" data-open={open} aria-label="Основная навигация">
          <Link href="/account" aria-current={page === "account" ? "page" : undefined}><AccountLinkLabel /></Link>
          <Link href="/booking" aria-current={page === "booking" ? "page" : undefined}>
            Бронирование
          </Link>
        </nav>
      </div>
    </header>
  );
}
