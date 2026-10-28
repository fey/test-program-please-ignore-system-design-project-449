// Регистрирует коннекторы из config/*.json. Повторный вызов обновляет
// настройки уже существующего коннектора, поэтому команду можно запускать
// после каждой правки файла.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { connect } from "./connect.ts";

const directory = path.join(import.meta.dirname, "..", "config");
let failed = false;

for (const file of (await readdir(directory)).filter((name) => name.endsWith(".json")).sort()) {
  const { name, config } = JSON.parse(await readFile(path.join(directory, file), "utf-8"));
  if (name === undefined || config === undefined) continue;
  const result = await connect("PUT", `/connectors/${name}/config`, config);
  if (result.status >= 400) {
    failed = true;
    console.error(`${file}: ${result.status} ${JSON.stringify(result.body)}`);
  } else {
    console.log(`${file}: коннектор ${name} применён`);
  }
}

process.exit(failed ? 1 : 0);
