import { query, transaction } from "./db.ts";
import { event, publish, source, directNotify } from "./source.ts";
import { pool } from "./db.ts";
import { randomUUID } from "node:crypto";
const instance = randomUUID();

export type Reply = { status: number; body: unknown };

const badRequest = (message: string): Reply => ({ status: 400, body: { error: message } });

const asNumber = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

type TripRow = {
  id: string;
  passenger_id: string;
  driver_id: string | null;
  status: string;
  city: string;
  price: string;
  created_at: Date;
  completed_at: Date | null;
  version: number;
};

const tripView = (row: TripRow) => ({
  id: Number(row.id),
  passengerId: Number(row.passenger_id),
  driverId: row.driver_id === null ? null : Number(row.driver_id),
  status: row.status,
  city: row.city,
  price: Number(row.price),
  createdAt: row.created_at,
  completedAt: row.completed_at,
});

const columns =
  "id, passenger_id, driver_id, status, city, price, created_at, completed_at, version";

const tripById = async (id: number) => {
  const result = await query<TripRow>(`SELECT ${columns} FROM trips WHERE id = $1`, [id]);
  return result.rows[0] ?? null;
};

export const health = async (): Promise<Reply> => {
  try {
    await query("SELECT 1");
    return { status: 200, body: { status: "ok", instance } };
  } catch {
    return { status: 503, body: { status: "database unavailable" } };
  }
};

export const getTrip = async (id: number): Promise<Reply> => {
  const row = await tripById(id);
  if (row === null) return { status: 404, body: { error: "trip not found" } };
  return { status: 200, body: tripView(row) };
};

export const createTrip = async (body: Record<string, unknown>): Promise<Reply> => {
  const passengerId = asNumber(body.passengerId);
  const price = asNumber(body.price);
  const city = typeof body.city === "string" ? body.city : "";
  if (passengerId === null || price === null || city === "") {
    return badRequest("passengerId, city and price are required");
  }
  const pickup = typeof body.pickupAddress === "string" ? body.pickupAddress : "Лесная улица, 10";
  const destination =
    typeof body.destinationAddress === "string" ? body.destinationAddress : "Садовая улица, 5";

  const result = await transaction(async (client) => {
    const inserted = await client.query<TripRow>(
      `INSERT INTO trips (passenger_id, city, price, pickup_address, destination_address)
       VALUES ($1, $2, $3, $4, $5) RETURNING ${columns}`,
      [passengerId, city, price, pickup, destination],
    );
    const row = inserted.rows[0];
    if (row === undefined) throw new Error("insert returned no row");
    await client.query("INSERT INTO trip_events (trip_id, event) VALUES ($1, $2)", [
      row.id,
      "created",
    ]);
    const fact = event(row, "created");
    if (source.mode === "transaction") await publish(client, fact);
    return { row, fact };
  });
  if (source.mode === "after_commit") await publish(pool, result.fact);
  if (source.mode === "direct") await directNotify(result.fact);
  return { status: 201, body: tripView(result.row) };
};

export const acceptTrip = async (tripId: number, body: Record<string, unknown>): Promise<Reply> => {
  const driverId = asNumber(body.driverId);
  if (driverId === null) return badRequest("driverId is required");

  return transaction(async (client) => {
    const trip = await client.query<TripRow>(
      `SELECT ${columns} FROM trips WHERE id = $1 FOR UPDATE`,
      [tripId],
    );
    const row = trip.rows[0];
    if (row === undefined) return { status: 404, body: { error: "trip not found" } };
    if (row.status !== "searching") {
      return { status: 409, body: { error: `trip is ${row.status}` } };
    }
    const driver = await client.query("SELECT 1 FROM drivers WHERE id = $1", [driverId]);
    if (driver.rows[0] === undefined) return { status: 404, body: { error: "driver not found" } };

    const updated = await client.query<TripRow>(
      `UPDATE trips SET driver_id = $1, status = 'accepted' WHERE id = $2 RETURNING ${columns}`,
      [driverId, tripId],
    );
    await client.query("INSERT INTO trip_events (trip_id, event) VALUES ($1, $2)", [
      tripId,
      "accepted",
    ]);
    const accepted = updated.rows[0];
    if (accepted === undefined) throw new Error("update returned no row");
    return { status: 200, body: tripView(accepted) };
  });
};

export const cancelTrip = async (tripId: number): Promise<Reply> =>
  transaction(async (client) => {
    const trip = await client.query<{ status: string }>(
      "SELECT status FROM trips WHERE id = $1 FOR UPDATE",
      [tripId],
    );
    const row = trip.rows[0];
    if (row === undefined) return { status: 404, body: { error: "trip not found" } };
    if (row.status === "completed" || row.status === "cancelled") {
      return { status: 409, body: { error: `trip is ${row.status}` } };
    }
    await client.query(`UPDATE trips SET status = 'cancelled' WHERE id = $1`, [tripId]);
    await client.query("INSERT INTO trip_events (trip_id, event) VALUES ($1, $2)", [
      tripId,
      "cancelled",
    ]);
    return { status: 200, body: { id: tripId, status: "cancelled" } };
  });

// Завершение поездки уже работает в стартовом приложении.
export const completeTrip = async (
  tripId: number,
  body: Record<string, unknown>,
): Promise<Reply> => {
  const at = typeof body.completedAt === "string" ? new Date(body.completedAt) : new Date();
  if (Number.isNaN(at.getTime())) return badRequest("completedAt must be a date");
  const result = await transaction(async (client) => {
    const selected = await client.query<TripRow>(
      `SELECT ${columns} FROM trips WHERE id = $1 FOR UPDATE`,
      [tripId],
    );
    const old = selected.rows[0];
    if (old === undefined)
      return { reply: { status: 404, body: { error: "trip not found" } }, fact: null };
    if (old.status === "completed")
      return { reply: { status: 200, body: tripView(old) }, fact: null };
    if (!["accepted", "in_progress"].includes(old.status)) {
      return { reply: { status: 409, body: { error: `trip is ${old.status}` } }, fact: null };
    }
    const updated = await client.query<TripRow>(
      `UPDATE trips SET status = 'completed', completed_at = $2, version = version + 1
       WHERE id = $1 RETURNING ${columns}`,
      [tripId, at.toISOString()],
    );
    const row = updated.rows[0]!;
    await client.query("INSERT INTO trip_events (trip_id, event) VALUES ($1, $2)", [
      tripId,
      "completed",
    ]);
    const fact = event(row, "completed");
    if (source.mode === "transaction") await publish(client, fact);
    return { reply: { status: 200, body: tripView(row) }, fact };
  });
  if (source.mode === "after_commit" && result.fact !== null) await publish(pool, result.fact);
  return result.reply;
};
