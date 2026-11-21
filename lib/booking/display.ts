import type { BookingStatus } from "../../prisma/generated/client/enums";

export const bookingStatusLabels: Record<BookingStatus, string> = {
  pending: "Ожидает подтверждения",
  confirmed: "Подтверждена",
  cancelled: "Отменена",
  completed: "Завершена",
  no_show: "Неявка",
};

export function formatBookingTime(value: Date | string, timeZone: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(new Date(value));
}

export function formatBookingDate(value: Date, timeZone: string) {
  return new Intl.DateTimeFormat("ru-RU", { timeZone, dateStyle: "long" }).format(value);
}
