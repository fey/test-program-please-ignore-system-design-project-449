// Общие вызовы REST API Kafka Connect для команд make.
export const connectUrl = process.env.CONNECT_URL ?? "http://connect:8083";

export const connect = async (method: string, path: string, body?: unknown) => {
  const response = await fetch(`${connectUrl}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text === "" ? null : JSON.parse(text) };
};
