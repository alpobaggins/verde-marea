import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "../../lib/auth/session";
import { AuthForm } from "../auth-form";

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const returnToBooking = (await searchParams).next === "booking";
  if (await currentUser()) redirect(returnToBooking ? "/booking" : "/account");

  return (
    <main className="auth-page">
      <Link href="/">Verde Marea</Link>
      <h1>Регистрация</h1>
      <AuthForm registration returnToBooking={returnToBooking} />
      <Link href={returnToBooking ? "/login?next=booking" : "/login"}>Войти в аккаунт</Link>
    </main>
  );
}
