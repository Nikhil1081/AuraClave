import { closeDatabase } from "./client.js";
import { checkDatabaseHealth } from "./health.js";

try {
  await checkDatabaseHealth();
} finally {
  await closeDatabase();
}

console.log("PostgreSQL connection is healthy.");
