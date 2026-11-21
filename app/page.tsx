import Link from "next/link";

export default function Home() {
  return (
    <main className="auth-page booking-page">
      <h1>Verde Marea</h1>
      <p>Локальная система бронирования столов ресторана.</p>
      <nav aria-label="Основная навигация">
        <Link href="/booking">Забронировать стол</Link>
        <Link href="/account">Личный кабинет</Link>
      </nav>
    </main>
  );
}
