import pg from "pg";
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const expected = `SELECT city, (created_at AT TIME ZONE 'UTC')::DATE AS day, 'created' AS event_type,
    COUNT(*)::INT AS trips, SUM(price)::NUMERIC AS total FROM trips GROUP BY 1, 2
  UNION ALL SELECT city, (completed_at AT TIME ZONE 'UTC')::DATE, 'completed', COUNT(*)::INT, SUM(price)::NUMERIC
    FROM trips WHERE status = 'completed' GROUP BY 1, 2`;
try {
  const source = (await db.query(expected)).rows;
  const actual = (await db.query("SELECT city, day, event_type, trips, total FROM daily_report"))
    .rows;
  const rows = (data: typeof source) =>
    new Map(
      data.map((r) => [
        `${r.city} ${new Date(r.day).toISOString().slice(0, 10)} ${r.event_type}`,
        `${Number(r.trips)} / ${Number(r.total)}`,
      ]),
    );
  const a = rows(source);
  const b = rows(actual);
  let wrong = 0;
  for (const key of [...new Set([...a.keys(), ...b.keys()])].sort()) {
    const ok = a.get(key) === b.get(key);
    if (!ok) wrong += 1;
    console.log(
      `${key}: база ${a.get(key) ?? "-"}, показатели ${b.get(key) ?? "-"}, ${ok ? "ok" : "РАСХОЖДЕНИЕ"}`,
    );
  }
  console.log(`Расхождений: ${wrong}`);
  process.exitCode = wrong === 0 ? 0 : 1;
} catch (error) {
  console.error(String(error), "Создайте daily_report командой make report.");
  process.exitCode = 2;
} finally {
  await db.end();
}
