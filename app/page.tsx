import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-4xl font-semibold">Verde Marea</h1>
      <p className="mt-4">Локальная система бронирования столов ресторана.</p>
      <Link className="mt-4 inline-block text-[#1f4d3a] underline" href="/account">Личный кабинет</Link>
    </main>
  );
}
