import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "../../lib/auth/session";
import { AuthForm } from "../auth-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ registered?: string; next?: string }>;
}) {
  const { registered, next } = await searchParams;
  const returnToBooking = next === "booking";
  if (await currentUser()) redirect(returnToBooking ? "/booking" : "/account");

  return (
    <main className="auth-page">
      <Link href="/">Verde Marea</Link>
      <h1>Вход</h1>
      {registered === "1" && <p role="status">Аккаунт создан. Войдите с вашим email и паролем.</p>}
      <AuthForm returnToBooking={returnToBooking} />
      <Link href={returnToBooking ? "/register?next=booking" : "/register"}>Зарегистрироваться</Link>
    </main>
  );
}
