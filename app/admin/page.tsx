import Link from "next/link";
import { redirect } from "next/navigation";
import { checkAdminAccess } from "../../lib/auth/access";
import { restaurantTimeZone } from "../../lib/booking/calendar";
import { AdminBookings } from "./bookings";
import { AdminAvailability } from "./availability";
import { AdminUsers } from "./users";
import { roleLabels } from "./labels";
import { AdminAudit } from "./audit";

const sections = [
  { id: "bookings", label: "Бронирования" },
  { id: "availability", label: "Доступность" },
  { id: "users", label: "Пользователи и роли" },
  { id: "audit", label: "Журнал аудита" },
] as const;

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ section?: string }> }) {
  const access = await checkAdminAccess();
  if (!access.allowed) {
    if (access.status === 401) redirect("/login");
    return (
      <main className="auth-page">
        <h1>Доступ запрещён</h1>
        <Link href="/account">Личный кабинет</Link>
      </main>
    );
  }

  const { section } = await searchParams;
  const active = sections.find(({ id }) => id === section) ?? sections[0];
  const timeZone = restaurantTimeZone();
  const superAdmin = access.user.role === "super_admin";

  return (
    <>
      <header className="admin-header">
        <div className="guest-container">
          <Link className="wordmark" href="/">Verde Marea</Link>
          <Link className="workspace-link" href="/account">Личный кабинет</Link>
        </div>
      </header>
      <main className="guest-container workspace admin-screen">
        <header className="admin-heading">
          <h1 className="guest-title">Администрирование</h1>
          <p data-role={access.user.role}>{roleLabels[access.user.role]} · {timeZone === "Europe/Moscow" ? "Московское время" : timeZone}</p>
        </header>
        <nav className="admin-nav" aria-label="Разделы администрирования">
          {sections.map(({ id, label }) => (
            <Link key={id} href={id === "bookings" ? "/admin" : `/admin?section=${id}`}
              aria-current={id === active.id ? "page" : undefined} prefetch={false}>{label}</Link>
          ))}
        </nav>
        <section className="workspace-stack" aria-labelledby="admin-section">
          <h2 id="admin-section">{active.label}</h2>
          {active.id === "bookings" && <AdminBookings timeZone={timeZone} />}
          {active.id === "availability" && <AdminAvailability timeZone={timeZone} />}
          {active.id === "users" && <AdminUsers superAdmin={superAdmin} />}
          {active.id === "audit" && <AdminAudit superAdmin={superAdmin} timeZone={timeZone} />}
        </section>
      </main>
    </>
  );
}
