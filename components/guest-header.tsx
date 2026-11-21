"use client";

import Link from "next/link";
import { useState } from "react";

export function GuestHeader({ page }: { page?: "home" | "booking" }) {
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
          <Link href="/account">Личный кабинет</Link>
          <Link href="/booking" aria-current={page === "booking" ? "page" : undefined}>
            Бронирование
          </Link>
        </nav>
      </div>
    </header>
  );
}
