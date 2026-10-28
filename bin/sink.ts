// Управление коннектором для опытов: status, pause, resume, replay.
// replay останавливает коннектор, сбрасывает его позицию в журнале на начало
// и запускает снова, поэтому приёмник читает все события заново.
import { connect } from "./connect.ts";

const [command, name] = process.argv.slice(2);
if (command === undefined || name === undefined) {
  console.error("использование: sink.ts <status|pause|resume|replay> <имя коннектора>");
  process.exit(2);
}

const must = async (result: ReturnType<typeof connect>, what: string) => {
  const { status, body } = await result;
  if (status >= 400) {
    console.error(`${what}: ${status} ${JSON.stringify(body)}`);
    process.exit(1);
  }
  return body;
};

if (command === "status") {
  const body = await must(connect("GET", `/connectors/${name}/status`), "status");
  console.log(
    `${name}: ${body.connector.state}, задачи: ${body.tasks.map((t: { state: string }) => t.state).join(", ")}`,
  );
} else if (command === "pause") {
  await must(connect("PUT", `/connectors/${name}/pause`), "pause");
  console.log(`${name}: на паузе`);
} else if (command === "resume") {
  await must(connect("PUT", `/connectors/${name}/resume`), "resume");
  console.log(`${name}: возобновлён`);
} else if (command === "replay") {
  await must(connect("PUT", `/connectors/${name}/stop`), "stop");
  let reset = false;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const { status } = await connect("DELETE", `/connectors/${name}/offsets`);
    if (status < 300) {
      reset = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  if (!reset) throw new Error("Connect не сбросил позицию за 30 попыток");
  await must(connect("PUT", `/connectors/${name}/resume`), "resume");
  console.log(`${name}: позиция сброшена, события читаются с начала`);
} else {
  console.error(`неизвестная команда ${command}`);
  process.exit(2);
}
