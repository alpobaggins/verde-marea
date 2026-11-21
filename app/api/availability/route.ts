import { availabilityInput, calculateAvailability } from "../../../lib/booking/availability";

const headers = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const date = params.getAll("date");
  const guests = params.getAll("guests");
  const input = availabilityInput.safeParse({
    date: date.length === 1 ? date[0] : undefined,
    guests: guests.length === 1 && /^[0-9]+$/.test(guests[0]) ? Number(guests[0]) : undefined,
  });

  if (!input.success) {
    return Response.json(
      { status: "invalid_input", error: "Укажите дату в формате ГГГГ-ММ-ДД и положительное целое число гостей." },
      { status: 400, headers },
    );
  }

  const result = await calculateAvailability(input.data);
  return Response.json({
    status: result.status,
    slots: result.slots.map(({ startsAt, endsAt }) => ({ startsAt, endsAt })),
  }, { headers });
}
