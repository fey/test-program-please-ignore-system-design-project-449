import type pg from "pg";

// SELECT-заглушка тоже возвращает rowCount=1. Проверяем сохранённый факт.
export const publishFact = async (
  client: pg.PoolClient | pg.Pool | pg.Client,
  sql: string,
  value: Record<string, unknown>,
) => {
  await client.query(sql, [JSON.stringify(value)]);
  const saved = await client.query(
    "SELECT 1 FROM outbox WHERE id=$1::uuid AND payload @> $2::jsonb",
    [value.eventId, JSON.stringify(value)],
  );
  if (saved.rowCount !== 1) throw new Error("SQL публикации не сохранил переданный факт в outbox");
};
