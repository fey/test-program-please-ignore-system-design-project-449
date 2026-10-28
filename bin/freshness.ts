import pg from "pg";
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
try {
  const notifications = await db.query(`SELECT count(*) AS samples,
    percentile_cont(.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM j.delivered_at-t.created_at)) AS p95_seconds
    FROM notification_jobs j JOIN trips t ON t.id=j.trip_id WHERE j.state='delivered'`);
  const projection = await db.query(`WITH first_delivery AS (
    SELECT eventid,MIN(received_at) AS at FROM trip_facts GROUP BY eventid
  ) SELECT count(*) AS samples,
    percentile_cont(.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM f.at-o.enqueued_at)) AS p95_seconds
    FROM first_delivery f JOIN outbox o ON o.id::text=f.eventid WHERE o.payload->>'historical'='false'`);
  const attempts = await db.query(`SELECT COALESCE(MAX(n),0) AS peak_attempts_per_second FROM
    (SELECT date_trunc('second',created_at),count(*) AS n FROM provider_attempts GROUP BY 1) a`);
  const pending = await db.query(
    `SELECT state,count(*) AS n FROM notification_jobs GROUP BY state`,
  );
  const expected = (
    await db.query(`SELECT
    (SELECT count(*) FROM trips)-(SELECT count(*) FROM initial_trip_facts WHERE payload->>'eventType'='created') AS notifications,
    (SELECT count(*) FROM trips)+(SELECT count(*) FROM trips WHERE status='completed')-(SELECT count(*) FROM initial_trip_facts) AS projection`)
  ).rows[0];
  const complete =
    Number(notifications.rows[0].samples) === Number(expected.notifications) &&
    Number(projection.rows[0].samples) === Number(expected.projection) &&
    pending.rows.every((row) => row.state === "delivered");
  console.log(
    JSON.stringify(
      {
        expected,
        complete,
        notifications: notifications.rows[0],
        projection: projection.rows[0],
        attempts: attempts.rows[0],
        jobs: pending.rows,
      },
      null,
      2,
    ),
  );
} finally {
  await db.end();
}
