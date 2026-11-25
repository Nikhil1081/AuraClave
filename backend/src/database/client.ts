import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { parseDatabaseConfig } from "./config.js";
import * as schema from "./schema.js";

export type IdentityDatabase = NodePgDatabase<typeof schema>;

export interface DatabaseConnection {
  database: IdentityDatabase;
  close: () => Promise<void>;
}

export function createDatabaseConnection(
  environment: NodeJS.ProcessEnv = process.env,
): DatabaseConnection {
  const pool = new Pool(parseDatabaseConfig(environment));
  pool.on("error", () => {
    console.error("Unexpected PostgreSQL idle client error.");
  });

  return {
    database: drizzle(pool, { schema }),
    close: () => pool.end(),
  };
}

let defaultConnection: DatabaseConnection | undefined;

export function getDatabase(): IdentityDatabase {
  defaultConnection ??= createDatabaseConnection();
  return defaultConnection.database;
}

export async function closeDatabase(): Promise<void> {
  if (defaultConnection) {
    const connection = defaultConnection;
    defaultConnection = undefined;
    await connection.close();
  }
}
