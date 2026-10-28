import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type pg from "pg";
import { publishFact } from "./publication.ts";

export type Event = {
  eventId: string;
  tripId: number;
  eventType: string;
  version: number;
  city: string;
  price: number;
  occurredAt: string;
  createdAt: string;
  historical: boolean;
};
export const source = JSON.parse(await readFile("config/source.json", "utf8")) as {
  mode: "direct" | "transaction" | "after_commit";
};
if (!["direct", "transaction", "after_commit"].includes(source.mode))
  throw new Error("unknown source.mode");
const sql = await readFile("db/publish-event.sql", "utf8");
export const event = (row: Record<string, unknown>, kind: "created" | "completed"): Event => ({
  historical: false,
  eventId: randomUUID(),
  tripId: Number(row.id),
  eventType: kind,
  version: Number(row.version),
  city: String(row.city),
  price: Number(row.price),
  // pg отдаёт время объектом Date, строка из String() теряет миллисекунды.
  occurredAt: new Date((kind === "created" ? row.created_at : row.completed_at) as Date).toISOString(),
  createdAt: new Date(row.created_at as Date).toISOString(),
});
// В режиме transaction вызывается с тем же клиентом, который изменяет поездку.
export const publish = (client: pg.PoolClient | pg.Pool, value: Event) =>
  publishFact(client, sql, value);
export const directNotify = async (value: Event) => {
  if (value.eventType !== "created") return;
  try {
    await fetch(`${process.env.PROVIDER_URL ?? "http://provider:8081"}/send`, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": value.eventId },
      body: JSON.stringify({
        tripId: value.tripId,
        text: `Заказ ${value.tripId} принят`,
        templateVersion: "direct",
      }),
      signal: AbortSignal.timeout(2000),
    });
  } catch (error) {
    console.error("direct notification failed", String(error));
  }
};
