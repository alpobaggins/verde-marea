const dayMs = 86_400_000;
const slotMinutes = 90;
export const restaurantWindowStarts = ["12:00", "13:30", "15:00", "16:30", "18:00", "19:30"] as const;
const minuteMs = 60_000;
type Interval = { startsAt: Date; endsAt: Date };

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

function localDateTime(instant: Date, formatter: Intl.DateTimeFormat) {
  const parts = formatter.formatToParts(instant);
  const { year, month, day, hour, minute, second } = Object.fromEntries(
    parts.map(({ type, value }) => [type, value]),
  );
  return `${year.padStart(4, "0")}-${month}-${day}T${hour}:${minute}:${second}`;
}

function toInstant(local: string, formatter: Intl.DateTimeFormat) {
  const wallTime = Date.parse(`${local}Z`);
  if (!Number.isFinite(wallTime)) return null;
  const offsetAt = (instant: number) =>
    Date.parse(`${localDateTime(new Date(instant), formatter)}Z`) - instant;

  const estimate = wallTime - offsetAt(wallTime);
  const instant = new Date(wallTime - offsetAt(estimate));
  return localDateTime(instant, formatter) === local ? instant : null;
}

function restaurantFormatter(timeZone: string) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });
}

export function restaurantDay(date: string, timeZone: string) {
  const formatter = restaurantFormatter(timeZone);
  const next = new Date(Date.parse(`${date}T00:00:00Z`) + dayMs).toISOString().slice(0, 10);
  const startsAt = toInstant(`${date}T00:00:00`, formatter);
  const endsAt = toInstant(`${next}T00:00:00`, formatter);
  return startsAt && endsAt ? { startsAt, endsAt } : null;
}

export function restaurantWindows(date: string, timeZone: string) {
  const formatter = restaurantFormatter(timeZone);
  const calendarDay = new Date(`${date}T00:00:00Z`);
  if (calendarDay.getUTCDay() === 1) return null;

  const closing = toInstant(`${date}T21:00:00`, formatter);
  if (!closing) return null;

  return restaurantWindowStarts.flatMap(
    (time): Interval[] => {
      const startsAt = toInstant(`${date}T${time}:00`, formatter);
      if (!startsAt) return [];
      const endsAt = new Date(startsAt.getTime() + slotMinutes * minuteMs);
      return endsAt <= closing ? [{ startsAt, endsAt }] : [];
    },
  );
}
