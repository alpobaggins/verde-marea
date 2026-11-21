import Link from "next/link";
import { redirect } from "next/navigation";
import { checkAdminAccess } from "../../lib/auth/access";

export default async function AdminPage() {
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

  return (
    <main className="auth-page">
      <Link href="/account">Личный кабинет</Link>
      <h1>Администрирование</h1>
      <p>Ваша роль — {access.user.role}</p>
    </main>
  );
}
