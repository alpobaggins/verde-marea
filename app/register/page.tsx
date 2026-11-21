import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "../../lib/auth/session";
import { AuthForm } from "../auth-form";

export default async function RegisterPage() {
  if (await currentUser()) redirect("/account");

  return (
    <main className="auth-page">
      <Link href="/">Verde Marea</Link>
      <h1>Регистрация</h1>
      <AuthForm registration />
      <Link href="/login">Войти в аккаунт</Link>
    </main>
  );
}
