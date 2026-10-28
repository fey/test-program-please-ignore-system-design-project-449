// Миграции и учебные данные применяются обычным SQL по порядку имён файлов.
// Каждый файл написан так, что повторный прогон его не ломает.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { config } from "./config.ts";

const root = path.join(import.meta.dirname, "..", "db");
const migrations = (await readdir(path.join(root, "migrations")))
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => path.join("migrations", name));

const client = new pg.Client({ connectionString: config.databaseUrl });
await client.connect();
for (const file of [...migrations, "seed.sql"]) {
  await client.query(await readFile(path.join(root, file), "utf-8"));
  console.log(`applied ${file}`);
}
await client.end();
