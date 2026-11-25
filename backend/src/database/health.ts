import { sql } from "drizzle-orm";
import { getDatabase, type IdentityDatabase } from "./client.js";

export async function checkDatabaseHealth(
  database: IdentityDatabase = getDatabase(),
): Promise<void> {
  await database.execute(sql`select 1`);
}
