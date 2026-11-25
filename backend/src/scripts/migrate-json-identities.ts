import "dotenv/config";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createDatabaseConnection } from "../database/client.js";
import {
  isDisposableMigrationDatabaseUrl,
  migrateLegacyIdentityUsers,
  type IdentityMigrationReport,
} from "../migrations/json-identity-migration.js";

const confirmationPhrase = "I_UNDERSTAND_THIS_WRITES_TO_DISPOSABLE_POSTGRES";
const defaultSourcePath = fileURLToPath(new URL("../../data/users.json", import.meta.url));

interface CliOptions {
  apply: boolean;
  sourcePath: string;
}

function blockedReport(message: string, mode: "dry-run" | "apply" = "dry-run"): IdentityMigrationReport {
  return {
    mode,
    status: "blocked",
    sourceTotal: 0,
    validRecords: 0,
    malformedRecords: [],
    duplicateNormalizedEmails: [],
    duplicateUserIds: [],
    alreadyMigrated: 0,
    plannedInserts: 0,
    inserted: 0,
    rejected: 0,
    conflicting: 0,
    targetConflicts: [],
    rootError: message,
  };
}

function failedReport(mode: "dry-run" | "apply", failureCode?: string): IdentityMigrationReport {
  return {
    ...blockedReport("Migration utility failed before completing the operation.", mode),
    status: "failed",
    ...(failureCode ? { failureCode } : {}),
  };
}

function parseOptions(args: string[]): CliOptions | undefined {
  const apply = args.includes("--apply");
  if (apply && args.includes("--dry-run")) {
    return undefined;
  }
  let sourcePath = defaultSourcePath;

  for (const arg of args) {
    if (arg === "--apply" || arg === "--dry-run") {
      continue;
    } else if (arg.startsWith("--source=") && arg.length > "--source=".length) {
      sourcePath = path.resolve(arg.slice("--source=".length));
    } else if (arg.startsWith("--confirm=")) {
      if (arg.slice("--confirm=".length) !== confirmationPhrase) {
        return undefined;
      }
    } else {
      return undefined;
    }
  }

  if (apply && !args.includes(`--confirm=${confirmationPhrase}`)) {
    return undefined;
  }

  return { apply, sourcePath };
}

function emit(report: IdentityMigrationReport): void {
  console.log(JSON.stringify(report, null, 2));
  if (report.status === "blocked" || report.status === "failed") {
    process.exitCode = 1;
  }
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  if (!options) {
    emit(blockedReport(
      `Invalid arguments. Dry-run is the default. Apply requires --apply --confirm=${confirmationPhrase}.`,
      process.argv.includes("--apply") ? "apply" : "dry-run",
    ));
    return;
  }

  if (process.env.NODE_ENV === "production") {
    emit(blockedReport("This preparation utility cannot run with NODE_ENV=production.", options.apply ? "apply" : "dry-run"));
    return;
  }

  const targetUrl = process.env.TEST_DATABASE_URL;
  if (!targetUrl || !isDisposableMigrationDatabaseUrl(targetUrl)) {
    emit(blockedReport(
      "TEST_DATABASE_URL must point to a loopback PostgreSQL database whose name contains 'test' or 'disposable'.",
      options.apply ? "apply" : "dry-run",
    ));
    return;
  }

  let input: unknown;
  try {
    input = JSON.parse(await readFile(options.sourcePath, "utf8"));
  } catch {
    emit(blockedReport("Source file could not be read or is not valid JSON.", options.apply ? "apply" : "dry-run"));
    return;
  }

  let connection: ReturnType<typeof createDatabaseConnection> | undefined;
  let report = failedReport(options.apply ? "apply" : "dry-run");
  try {
    connection = createDatabaseConnection({
      DATABASE_URL: targetUrl,
      DATABASE_SSL: "disable",
      NODE_ENV: "test",
    });
    report = await migrateLegacyIdentityUsers(input, connection.database, { apply: options.apply });
  } catch {
    report = failedReport(options.apply ? "apply" : "dry-run");
  }

  if (connection) {
    try {
      await connection.close();
    } catch {
      report.status = "failed";
      report.failureCode = "POOL_CLOSE_FAILED";
    }
  }
  emit(report);
}

main().catch(() => {
  emit(failedReport(process.argv.includes("--apply") ? "apply" : "dry-run"));
});
