import Image from "next/image";
import Link from "next/link";
import { GuestHeader } from "../components/guest-header";

export default function Home() {
  return (
    <>
      <GuestHeader page="home" />
      <main className="guest-container home-main">
        <section className="home-hero" aria-labelledby="restaurant-name">
          <div className="home-intro">
            <p className="home-category">Средиземноморский ресторан</p>
            <h1 id="restaurant-name" className="guest-title">Verde Marea</h1>
            <p className="home-description">
              Рыба на гриле, оливковое масло и сезонные овощи. Простой вкус Средиземноморья за неспешным обедом или ужином.
            </p>
            <Link className="button" href="/booking">Забронировать стол</Link>
          </div>
          <div className="home-photo">
            <Image
              src="/images/restaurant.webp"
              alt="Рыба на гриле на сервированном столе в солнечном зале"
              fill
              preload
              sizes="(min-width: 1280px) 660px, (min-width: 768px) 55vw, 100vw"
            />
          </div>
        </section>
        <section className="home-hours" aria-labelledby="restaurant-hours">
          <h2 id="restaurant-hours">Часы работы</h2>
          <p>Вторник–воскресенье <span>12:00–21:00</span></p>
          <p>Понедельник <span>выходной</span></p>
        </section>
      </main>
    </>
  );
}
