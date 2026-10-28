import { readFile } from "node:fs/promises";
import pg from "pg";
import { publishFact } from "../src/publication.ts";

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
try {
  await db.query("BEGIN");
  await db.query("LOCK TABLE trips IN SHARE ROW EXCLUSIVE MODE");
  await db.query("LOCK TABLE outbox IN SHARE ROW EXCLUSIVE MODE");
  const first = await db.query(
    "INSERT INTO source_activation(singleton) VALUES(TRUE) ON CONFLICT DO NOTHING RETURNING singleton",
  );
  if (first.rowCount === 1) {
    const snapshot = await db.query(await readFile("db/backfill.sql", "utf8"));
    for (const row of snapshot.rows)
      await db.query("INSERT INTO initial_trip_facts(event_id,payload) VALUES($1,$2)", [
        row.payload.eventId,
        row.payload,
      ]);
  }
  const rows = await db.query(
    "SELECT s.payload FROM initial_trip_facts s WHERE NOT EXISTS (SELECT 1 FROM outbox o WHERE o.id=s.event_id) ORDER BY (s.payload->>'tripId')::bigint, CASE s.payload->>'eventType' WHEN 'created' THEN 0 ELSE 1 END",
  );
  const sql = await readFile("db/publish-event.sql", "utf8");
  for (const row of rows.rows) await publishFact(db, sql, row.payload);
  await db.query("COMMIT");
  console.log(`Начальный снимок опубликовал ${rows.rowCount} фактов. Граница активации сохранена.`);
} catch (error) {
  await db.query("ROLLBACK");
  throw error;
} finally {
  await db.end();
}
