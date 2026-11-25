import { z } from "zod";
import type { PoolConfig } from "pg";

const databaseEnvironmentSchema = z.object({
  DATABASE_URL: z
    .string()
    .refine((value) => {
      try {
        return ["postgres:", "postgresql:"].includes(new URL(value).protocol);
      } catch {
        return false;
      }
    }),
  DATABASE_SSL: z.enum(["require", "disable"]).optional(),
  NODE_ENV: z.string().optional(),
});

export function parseDatabaseConfig(
  environment: NodeJS.ProcessEnv = process.env,
): PoolConfig {
  const parsed = databaseEnvironmentSchema.safeParse(environment);

  if (!parsed.success) {
    throw new Error("DATABASE_URL must be a valid PostgreSQL connection URL.");
  }

  if (parsed.data.NODE_ENV === "production" && parsed.data.DATABASE_SSL === "disable") {
    throw new Error("DATABASE_SSL=disable is not allowed in production.");
  }

  const useTls =
    parsed.data.DATABASE_SSL === "require" ||
    (parsed.data.DATABASE_SSL === undefined && parsed.data.NODE_ENV === "production");

  return {
    connectionString: parsed.data.DATABASE_URL,
    ssl: useTls ? { rejectUnauthorized: true } : parsed.data.DATABASE_SSL === "disable" ? false : undefined,
    max: 10,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
  };
}
