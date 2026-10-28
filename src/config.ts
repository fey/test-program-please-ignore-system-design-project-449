export const config = {
  port: Number(process.env.PORT ?? 8080),
  databaseUrl: process.env.DATABASE_URL ?? "postgres://postgres@localhost:5432/taxi",
  poolSize: Number(process.env.POOL_SIZE ?? 10),
};
