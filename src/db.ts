import pg from "pg";
import { config } from "./config.ts";

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: config.poolSize });

export const query = <T extends pg.QueryResultRow>(sql: string, params: unknown[] = []) =>
  pool.query<T>(sql, params);

export const transaction = async <T>(run: (client: pg.PoolClient) => Promise<T>): Promise<T> => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await run(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};
