import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "../../lib/auth/session";
import { GuestHeader } from "../../components/guest-header";
import { AuthForm } from "../auth-form";

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const returnToBooking = (await searchParams).next === "booking";
  if (await currentUser()) redirect(returnToBooking ? "/booking" : "/account");

  return (
    <>
      <GuestHeader />
      <main className="guest-container guest-auth">
        <h1 className="guest-title">Регистрация</h1>
        <div className="guest-panel guest-auth-panel">
          <AuthForm registration returnToBooking={returnToBooking} />
          <Link href={returnToBooking ? "/login?next=booking" : "/login"}>Войти в аккаунт</Link>
        </div>
      </main>
    </>
  );
}
