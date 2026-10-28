import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import pg from "pg";

const policyFile = process.env.NOTIFIER_POLICY ?? "config/notifier.json";
const policy = JSON.parse(await readFile(policyFile, "utf8")) as {
  version: string;
  template: string;
  timeoutMs: number;
  retryDelayMs: number;
  leaseMs: number;
  maxAttemptsPerSecond: number;
  maxRetryAgeMs: number;
};
if (
  !(
    policy.timeoutMs > 0 &&
    policy.timeoutMs < policy.leaseMs &&
    policy.retryDelayMs > 0 &&
    policy.maxAttemptsPerSecond > 0 &&
    policy.maxAttemptsPerSecond <= 100 &&
    policy.maxRetryAgeMs > 0 &&
    policy.maxRetryAgeMs < 86400000
  )
) {
  throw new Error(
    "timeoutMs must be positive and smaller than leaseMs; retryDelayMs must be positive",
  );
}
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
const provider = process.env.PROVIDER_URL ?? "http://provider:8081";
const instance = randomUUID();
let running = true;
const server = createServer(async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ instance, version: policy.version, policyFile }));
  } catch {
    res.writeHead(503);
    res.end();
  }
});
server.listen(8082);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const tick = async () => {
  // Приёмник Kafka сохраняет факты. Отправитель создаёт обязательства только
  // для созданий поездок. Повторная доставка сохраняет прежнее обязательство.
  await pool.query(`WITH batch AS (
      SELECT eventid,tripid FROM notify_inbox
      WHERE eventtype='created' AND NOT historical AND NOT job_created
      LIMIT 500 FOR UPDATE SKIP LOCKED
    ), inserted AS (
      INSERT INTO notification_jobs(event_id,trip_id) SELECT eventid,tripid FROM batch
      ON CONFLICT(event_id) DO NOTHING RETURNING event_id
    ) UPDATE notify_inbox i SET job_created=TRUE FROM batch b WHERE i.eventid=b.eventid`);
  await pool.query(
    `UPDATE notification_jobs SET state='expired', last_error='retry age exceeded'
    WHERE state='pending' AND first_attempt_at < clock_timestamp()-$1*INTERVAL '1 millisecond'
    AND (claimed_until IS NULL OR claimed_until < clock_timestamp())`,
    [policy.maxRetryAgeMs],
  );
  // Общий интервал разрешений для всех экземпляров, включая повторы после 503.
  const permit = await pool.query(
    `UPDATE notification_rate_gate
    SET next_at=clock_timestamp()+$1*INTERVAL '1 millisecond'
    WHERE singleton AND next_at<=clock_timestamp() RETURNING singleton`,
    [1000 / policy.maxAttemptsPerSecond],
  );
  if (permit.rowCount === 0) {
    await sleep(5);
    return;
  }
  const claim = await pool.query(
    `WITH candidate AS (
      SELECT event_id FROM notification_jobs
      WHERE state = 'pending' AND next_attempt <= NOW()
        AND (claimed_until IS NULL OR claimed_until < NOW())
      ORDER BY next_attempt, event_id FOR UPDATE SKIP LOCKED LIMIT 1
    ) UPDATE notification_jobs AS j
      SET claimed_until = NOW() + $1 * INTERVAL '1 millisecond', claim_token = gen_random_uuid(),
          attempts = attempts + 1, first_attempt_at=COALESCE(first_attempt_at,clock_timestamp())
      FROM candidate AS c WHERE j.event_id = c.event_id RETURNING j.*`,
    [policy.leaseMs],
  );
  const job = claim.rows[0];
  if (job === undefined) {
    await sleep(100);
    return;
  }
  let status = 0;
  let error = "";
  let deliveredVersion: string | null = null;
  try {
    const response = await fetch(`${provider}/send`, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": job.event_id },
      body: JSON.stringify({
        tripId: Number(job.trip_id),
        templateVersion: policy.version,
        text: policy.template.replaceAll("{tripId}", String(job.trip_id)),
      }),
      signal: AbortSignal.timeout(policy.timeoutMs),
    });
    status = response.status;
    error = `HTTP ${status}`;
    // Провайдер в этом стенде отвечает 200 только после сохранения эффекта.
    if (status === 200) {
      const acknowledgement = (await response.json()) as {
        delivered?: boolean;
        templateVersion?: string;
      };
      if (acknowledgement.delivered !== true || typeof acknowledgement.templateVersion !== "string")
        status = 0;
      else deliveredVersion = acknowledgement.templateVersion;
    }
  } catch (cause) {
    status = 0;
    error = String(cause);
  }
  const state = status === 200 ? "delivered" : status === 422 ? "quarantined" : "pending";
  await pool.query(
    `UPDATE notification_jobs SET state = $2, claimed_until = NULL, claim_token = NULL,
      last_error = $3, next_attempt = NOW() + $4 * INTERVAL '1 millisecond',
      delivered_at = CASE WHEN $2 = 'delivered' THEN NOW() ELSE NULL END,
      template_version = CASE WHEN $2 = 'delivered' THEN $5 ELSE template_version END
      WHERE event_id = $1 AND claim_token = $6`,
    [
      job.event_id,
      state,
      error,
      status === 429 ? Math.max(1000, policy.retryDelayMs) : policy.retryDelayMs,
      deliveredVersion,
      job.claim_token,
    ],
  );
};
process.on("SIGTERM", () => {
  running = false;
});
process.on("SIGINT", () => {
  running = false;
});
while (running) {
  try {
    await tick();
  } catch (error) {
    console.error("notifier", error);
    await sleep(500);
  }
}
await new Promise<void>((resolve) => server.close(() => resolve()));
await pool.end();
