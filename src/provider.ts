import { createServer } from "node:http";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let mode = "healthy";
let limit = 100;
let second = 0;
let requests = 0;
const server = createServer(async (req, res) => {
  const reply = (status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  try {
    if (req.url === "/health") {
      await pool.query("SELECT 1");
      reply(200, { mode, limit });
      return;
    }
    if (req.url === "/deliveries") {
      reply(200, (await pool.query("SELECT * FROM provider_deliveries ORDER BY id")).rows);
      return;
    }
    let raw = "";
    for await (const chunk of req) raw += String(chunk);
    const body = JSON.parse(raw || "{}") as Record<string, unknown>;
    if (req.url === "/mode" && req.method === "POST") {
      const allowed = ["healthy", "unavailable", "slow", "lost-response"];
      if (body.mode !== undefined && !allowed.includes(String(body.mode))) {
        reply(400, { error: "unknown mode" });
        return;
      }
      mode = String(body.mode ?? "healthy");
      limit = Math.max(1, Number(body.limit ?? 100));
      reply(200, { mode, limit });
      return;
    }
    if (req.url !== "/send" || req.method !== "POST") {
      reply(404, {});
      return;
    }
    const key = String(req.headers["idempotency-key"] ?? "");
    if (
      !key ||
      !Number.isInteger(Number(body.tripId)) ||
      typeof body.text !== "string" ||
      typeof body.templateVersion !== "string"
    ) {
      reply(422, { error: "key, tripId and text required" });
      return;
    }
    await pool.query("INSERT INTO provider_attempts (key) VALUES ($1)", [key]);
    const now = Math.floor(Date.now() / 1000);
    if (now !== second) {
      second = now;
      requests = 0;
    }
    requests += 1;
    if (requests > limit) {
      res.setHeader("Retry-After", "1");
      reply(429, {});
      return;
    }
    if (mode === "unavailable") {
      reply(503, {});
      return;
    }
    if (mode === "slow") await new Promise((r) => setTimeout(r, 2000));
    const client = await pool.connect();
    let duplicate = false;
    let deliveredVersion = String(body.templateVersion);
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [key]);
      const old = await client.query(
        "SELECT 1 FROM provider_keys WHERE key = $1 AND expires_at > NOW()",
        [key],
      );
      duplicate = old.rowCount !== 0;
      if (!duplicate) {
        await client.query(
          "INSERT INTO provider_keys (key, expires_at) VALUES ($1, NOW() + INTERVAL '24 hours') ON CONFLICT (key) DO UPDATE SET expires_at = EXCLUDED.expires_at",
          [key],
        );
        await client.query(
          "INSERT INTO provider_deliveries (key, trip_id, text, template_version) VALUES ($1, $2, $3, $4)",
          [key, body.tripId, body.text, body.templateVersion],
        );
      }
      if (duplicate) {
        const actual = await client.query(
          "SELECT template_version FROM provider_deliveries WHERE key=$1 ORDER BY id DESC LIMIT 1",
          [key],
        );
        deliveredVersion = actual.rows[0]?.template_version ?? "unknown";
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    if (mode === "lost-response") {
      res.destroy();
      return;
    }
    reply(200, { delivered: true, duplicate, templateVersion: deliveredVersion });
  } catch (error) {
    console.error(error);
    reply(500, { error: String(error) });
  }
});
server.listen(8081, () => console.log("provider listening on 8081"));
process.on("SIGTERM", () =>
  server.close(async () => {
    await pool.end();
    process.exit(0);
  }),
);
