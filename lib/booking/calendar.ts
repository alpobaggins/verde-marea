const dayMs = 86_400_000;

export function restaurantTimeZone() {
  return process.env.RESTAURANT_TIME_ZONE ?? "Europe/Moscow";
}

export function bookingDateRange(now: Date, timeZone: string) {
  const first = new Intl.DateTimeFormat("sv-SE", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
  // UTC here represents calendar dates, irrespective of the process time zone.
  const firstDay = Date.parse(`${first}T00:00:00Z`);
  const last = new Date(firstDay + 13 * dayMs).toISOString().slice(0, 10);
  return { first, last };
}
