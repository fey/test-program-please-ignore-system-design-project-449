const mode = process.argv[2] ?? "healthy";
const response = await fetch("http://provider:8081/mode", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ mode, limit: Number(process.env.LIMIT ?? 100) }),
});
console.log(await response.text());
if (!response.ok) process.exitCode = 1;
