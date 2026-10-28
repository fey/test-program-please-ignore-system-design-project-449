// Генератор поездок. Создаёт, назначает и завершает N поездок через HTTP.
// Доля HOT поездок приходится на первый город списка, остальные делятся
// поровну, поэтому поток неравномерный, как у настоящего такси.
//
// Параметры задаются переменными окружения: N (число поездок, 100 по
// умолчанию), HOT (доля главного города, 0.7), DAYS_BACK (разброс времени
// завершения в днях назад, 0).
const appUrl = process.env.APP_URL ?? "http://app:8080";
const total = Number(process.env.N ?? 100);
const hot = Number(process.env.HOT ?? 0.7);
const daysBack = Number(process.env.DAYS_BACK ?? 0);
const cities = ["moscow", "spb", "kazan", "sochi"];

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

const pickCity = () => {
  if (Math.random() < hot) return cities[0];
  return cities[1 + Math.floor(Math.random() * (cities.length - 1))];
};

const rps = Number(process.env.RPS ?? 0);
if (!Number.isFinite(rps) || rps < 0) throw new Error("RPS must be nonnegative");
const generationStarted = Date.now();
let done = 0;
for (let n = 0; n < total; n += 1) {
  const started = Date.now();
  const trip = await post("/trips", {
    passengerId: 1 + (n % 1000),
    city: pickCity(),
    price: 300 + Math.floor(Math.random() * 700),
  });
  await post(`/trips/${trip.id}/accept`, { driverId: 1 + (n % 1000) });
  const completedAt = new Date(Date.now() - Math.floor(Math.random() * daysBack * 86400000));
  await post(`/trips/${trip.id}/complete`, { completedAt: completedAt.toISOString() });
  done += 1;
  if (rps > 0)
    await new Promise((resolve) =>
      setTimeout(resolve, Math.max(0, 1000 / rps - (Date.now() - started))),
    );
}
console.log(`завершено поездок: ${done}`);

const seconds = (Date.now() - generationStarted) / 1000;
console.log(
  `Длительность генерации ${seconds.toFixed(2)} с, фактический темп ${(done / seconds).toFixed(2)} поездок/с`,
);
