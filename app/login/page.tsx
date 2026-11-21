import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "../../lib/auth/session";
import { GuestHeader } from "../../components/guest-header";
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
    <>
      <GuestHeader />
      <main className="guest-container guest-auth">
        <h1 className="guest-title">Вход</h1>
        <div className="guest-panel guest-auth-panel">
          {registered === "1" && <p role="status">Аккаунт создан. Войдите с вашим email и паролем.</p>}
          <AuthForm returnToBooking={returnToBooking} />
          <Link href={returnToBooking ? "/register?next=booking" : "/register"}>Зарегистрироваться</Link>
        </div>
      </main>
    </>
  );
}
