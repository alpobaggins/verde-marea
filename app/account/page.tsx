import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "../../lib/auth/session";
import { LogoutForm } from "../auth-form";

export default async function AccountPage() {
  const user = await currentUser();
  if (!user) redirect("/login");

  return (
    <main className="auth-page">
      <Link href="/">Verde Marea</Link>
      <h1>Личный кабинет</h1>
      <p className="break-all">Email: {user.email}</p>
      <LogoutForm />
    </main>
  );
}
