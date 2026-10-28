import { readFile } from "node:fs/promises";
import pg from "pg";
import { connect } from "./connect.ts";
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
try {
  const { name, config } = JSON.parse(
    await readFile("config/rebuild/projection-sink.json", "utf8"),
  );
  if (name === "projection-sink" || config["collection.name.format"] === "trip_facts")
    throw new Error("Нужны отдельная группа и таблица");
  const result = await connect("PUT", `/connectors/${name}/config`, config);
  if (result.status >= 300) throw new Error(JSON.stringify(result.body));
  const expected = Number((await db.query("SELECT COUNT(*) AS n FROM outbox")).rows[0].n);
  let ready = false;
  for (let n = 0; n < 90; n += 1) {
    try {
      const actual = Number(
        (await db.query("SELECT COUNT(DISTINCT eventid) AS n FROM trip_facts_v2")).rows[0].n,
      );
      if (actual >= expected) {
        ready = true;
        break;
      }
    } catch (error) {
      if ((error as { code?: string }).code !== "42P01") throw error;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (!ready) throw new Error("Вторая проекция не получила историю за 90 секунд");
  await db.query(await readFile("db/report-v2.sql", "utf8"));
  console.log(
    "daily_report_v2 построено. Сверьте его с daily_report при остановленном генераторе.",
  );
} finally {
  await db.end();
}
