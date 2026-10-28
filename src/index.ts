import { createServer } from "node:http";
import type { IncomingMessage } from "node:http";
import { config } from "./config.ts";
import { pool } from "./db.ts";
import * as handlers from "./handlers.ts";
import type { Reply } from "./handlers.ts";

const readJson = async (request: IncomingMessage): Promise<Record<string, unknown>> => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf-8");
  if (raw === "") return {};
  const parsed: unknown = JSON.parse(raw);
  return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
};

type Route = {
  method: string;
  pattern: RegExp;
  run: (match: RegExpMatchArray, request: IncomingMessage) => Promise<Reply>;
};

const routes: Route[] = [
  { method: "GET", pattern: /^\/health$/, run: () => handlers.health() },
  {
    method: "POST",
    pattern: /^\/trips$/,
    run: async (_match, request) => handlers.createTrip(await readJson(request)),
  },
  { method: "GET", pattern: /^\/trips\/(\d+)$/, run: async (m) => handlers.getTrip(Number(m[1])) },
  {
    method: "POST",
    pattern: /^\/trips\/(\d+)\/accept$/,
    run: async (m, request) => handlers.acceptTrip(Number(m[1]), await readJson(request)),
  },
  {
    method: "POST",
    pattern: /^\/trips\/(\d+)\/cancel$/,
    run: async (m) => handlers.cancelTrip(Number(m[1])),
  },
  {
    method: "POST",
    pattern: /^\/trips\/(\d+)\/complete$/,
    run: async (m, request) => handlers.completeTrip(Number(m[1]), await readJson(request)),
  },
];

const send = (response: import("node:http").ServerResponse, reply: Reply) => {
  response.writeHead(reply.status, { "content-type": "application/json" });
  response.end(JSON.stringify(reply.body));
};

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  const route = routes.find((r) => r.method === request.method && r.pattern.test(url.pathname));
  if (route === undefined) {
    send(response, { status: 404, body: { error: "route not found" } });
    return;
  }
  try {
    const match = url.pathname.match(route.pattern);
    if (match === null) throw new Error("route matched but capture failed");
    send(response, await route.run(match, request));
  } catch (error) {
    console.error(error);
    send(response, { status: 500, body: { error: "internal error" } });
  }
});

server.listen(config.port, () => {
  console.log(`taxi listening on ${config.port}`);
});

const shutdown = () => {
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
