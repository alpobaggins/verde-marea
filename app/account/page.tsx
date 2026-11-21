import Link from "next/link";
import { requireSignedInUser } from "../../lib/auth/access";
import { canAccessAdministration } from "../../lib/auth/permissions";
import { LogoutForm } from "../auth-form";

export default async function AccountPage() {
  const user = await requireSignedInUser();

  return (
    <main className="auth-page">
      <Link href="/">Verde Marea</Link>
      <h1>Личный кабинет</h1>
      <p className="break-all">Email: {user.email}</p>
      {canAccessAdministration(user.role) && (
        <Link href="/admin" prefetch={false}>Администрирование</Link>
      )}
      <LogoutForm />
    </main>
  );
}
