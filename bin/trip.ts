// Создаёт и назначает одну поездку и печатает её номер. Поездку не завершает,
// завершение остаётся за вами: make complete TRIP=<номер>.
const appUrl = process.env.APP_URL ?? "http://app:8080";
const city = process.env.CITY ?? "moscow";

const post = async (path: string, body: unknown) => {
  const response = await fetch(`${appUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const parsed = await response.json();
  if (response.status >= 400)
    throw new Error(`${path}: ${response.status} ${JSON.stringify(parsed)}`);
  return parsed as { id: number };
};

const trip = await post("/trips", { passengerId: 1, city, price: 500 });
await post(`/trips/${trip.id}/accept`, { driverId: 1 });
console.log(trip.id);
