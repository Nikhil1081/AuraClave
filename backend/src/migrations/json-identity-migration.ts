import { inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { IdentityDatabase } from "../database/client.js";
import { users } from "../database/schema.js";

const bcryptHashPattern = /^\$2[aby]\$(0[4-9]|[12]\d|3[01])\$[./A-Za-z0-9]{53}$/;
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

const sourceUserSchema = z
  .object({
    id: z.string().uuid(),
    email: z.string().trim().email(),
    passwordHash: z.string().regex(bcryptHashPattern, "Unsupported password hash format."),
    fullName: z.string().refine((value) => value.trim().length > 0, "Full name must not be blank."),
    avatarUrl: z.string().nullable().optional(),
    createdAt: z
      .string()
      .regex(timestampPattern, "Created timestamp must be ISO 8601 with a timezone.")
      .refine((value) => Number.isFinite(Date.parse(value)), "Created timestamp is invalid."),
  })
  .strict();

type ParsedSourceUser = z.infer<typeof sourceUserSchema>;
type TargetUser = typeof users.$inferSelect;
type UserInsert = typeof users.$inferInsert;
type PreparedUserInsert = UserInsert & { id: string; email: string; createdAt: Date };

export interface SourceIssue {
  path: string;
  code: string;
  message: string;
}

export interface MalformedSourceRecord {
  sourceIndex: number;
  sourceId?: string;
  issues: SourceIssue[];
}

export interface DuplicateSourceValue {
  value: string;
  sourceIndexes: number[];
}

export interface TargetConflict {
  sourceIndex: number;
  userId: string;
  reason: "user_id_exists_with_different_data" | "email_exists_with_different_user";
  conflictingUserId: string;
  conflictingUserIds: string[];
  conflictingFields: Array<
    "id" | "email" | "passwordHash" | "fullName" | "avatarUrl" | "status" | "emailVerifiedAt" | "lastLoginAt" | "createdAt"
  >;
}

export interface SourceReview {
  sourceTotal: number;
  validRecords: PreparedUserInsert[];
  malformedRecords: MalformedSourceRecord[];
  duplicateNormalizedEmails: DuplicateSourceValue[];
  duplicateUserIds: DuplicateSourceValue[];
  rootError?: string;
}

export interface IdentityMigrationReport {
  mode: "dry-run" | "apply";
  status: "ready" | "blocked" | "completed" | "failed";
  sourceTotal: number;
  validRecords: number;
  malformedRecords: MalformedSourceRecord[];
  duplicateNormalizedEmails: DuplicateSourceValue[];
  duplicateUserIds: DuplicateSourceValue[];
  alreadyMigrated: number;
  plannedInserts: number;
  inserted: number;
  rejected: number;
  conflicting: number;
  targetConflicts: TargetConflict[];
  rootError?: string;
  failureCode?: string;
}

export function normalizeIdentityEmail(email: string): string {
  return email.trim().toLowerCase();
}

function mapSourceUser(source: ParsedSourceUser): PreparedUserInsert {
  const createdAt = new Date(source.createdAt);
  return {
    id: source.id.toLowerCase(),
    email: normalizeIdentityEmail(source.email),
    passwordHash: source.passwordHash,
    fullName: source.fullName,
    avatarUrl: source.avatarUrl ?? null,
    status: "active",
    emailVerifiedAt: null,
    lastLoginAt: null,
    createdAt,
    updatedAt: createdAt,
  };
}

function duplicateGroups(values: Map<string, number[]>): DuplicateSourceValue[] {
  return [...values.entries()]
    .filter(([, indexes]) => indexes.length > 1)
    .map(([value, indexes]) => ({ value, sourceIndexes: indexes }));
}

function addSourceValue(groups: Map<string, number[]>, value: string, sourceIndex: number): void {
  const indexes = groups.get(value) ?? [];
  indexes.push(sourceIndex);
  groups.set(value, indexes);
}

export function reviewLegacyIdentitySource(input: unknown): SourceReview {
  if (!Array.isArray(input)) {
    return {
      sourceTotal: 0,
      validRecords: [],
      malformedRecords: [],
      duplicateNormalizedEmails: [],
      duplicateUserIds: [],
      rootError: "Source JSON must be an array of user records.",
    };
  }
  if (input.length === 0) {
    return {
      sourceTotal: 0,
      validRecords: [],
      malformedRecords: [],
      duplicateNormalizedEmails: [],
      duplicateUserIds: [],
      rootError: "Source JSON must contain at least one user record.",
    };
  }

  const malformedRecords: MalformedSourceRecord[] = [];
  const validRecords: PreparedUserInsert[] = [];
  const emailGroups = new Map<string, number[]>();
  const idGroups = new Map<string, number[]>();

  input.forEach((value: unknown, index: number) => {
    const sourceIndex = index + 1;
    if (typeof value === "object" && value !== null) {
      const record = value as Record<string, unknown>;
      if (typeof record.id === "string" && record.id.length > 0) {
        addSourceValue(idGroups, record.id.toLowerCase(), sourceIndex);
      }
      if (typeof record.email === "string" && record.email.trim().length > 0) {
        addSourceValue(emailGroups, normalizeIdentityEmail(record.email), sourceIndex);
      }
    }

    const parsed = sourceUserSchema.safeParse(value);
    if (!parsed.success) {
      const rawId =
        typeof value === "object" && value !== null
          ? (value as Record<string, unknown>).id
          : undefined;
      const safeId = typeof rawId === "string" ? z.string().uuid().safeParse(rawId) : undefined;
      malformedRecords.push({
        sourceIndex,
        ...(safeId?.success ? { sourceId: safeId.data.toLowerCase() } : {}),
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.map(String).join(".") || "$",
          code: issue.code,
          message: issue.message,
        })),
      });
      return;
    }

    validRecords.push(mapSourceUser(parsed.data));
  });

  return {
    sourceTotal: input.length,
    validRecords,
    malformedRecords,
    duplicateNormalizedEmails: duplicateGroups(emailGroups),
    duplicateUserIds: duplicateGroups(idGroups),
  };
}

function hasSourceIssues(review: SourceReview): boolean {
  return Boolean(
    review.rootError ||
      review.malformedRecords.length ||
      review.duplicateNormalizedEmails.length ||
      review.duplicateUserIds.length,
  );
}

function baseReport(
  mode: IdentityMigrationReport["mode"],
  review: SourceReview,
): IdentityMigrationReport {
  const rejectedSourceIndexes = new Set<number>([
    ...review.malformedRecords.map((record) => record.sourceIndex),
    ...review.duplicateNormalizedEmails.flatMap((group) => group.sourceIndexes),
    ...review.duplicateUserIds.flatMap((group) => group.sourceIndexes),
  ]);

  return {
    mode,
    status: "blocked",
    sourceTotal: review.sourceTotal,
    validRecords: review.validRecords.length,
    malformedRecords: review.malformedRecords,
    duplicateNormalizedEmails: review.duplicateNormalizedEmails,
    duplicateUserIds: review.duplicateUserIds,
    alreadyMigrated: 0,
    plannedInserts: 0,
    inserted: 0,
    rejected: rejectedSourceIndexes.size,
    conflicting: 0,
    targetConflicts: [],
    ...(review.rootError ? { rootError: review.rootError } : {}),
  };
}

function conflictingFields(target: TargetUser, source: PreparedUserInsert): TargetConflict["conflictingFields"] {
  const fields: TargetConflict["conflictingFields"] = [];
  if (target.id !== source.id) fields.push("id");
  if (target.email !== source.email) fields.push("email");
  if (target.passwordHash !== source.passwordHash) fields.push("passwordHash");
  if (target.fullName !== source.fullName) fields.push("fullName");
  if ((target.avatarUrl ?? null) !== (source.avatarUrl ?? null)) fields.push("avatarUrl");
  if (target.status !== "active") fields.push("status");
  if (target.emailVerifiedAt !== null) fields.push("emailVerifiedAt");
  if (target.lastLoginAt !== null) fields.push("lastLoginAt");
  if (target.createdAt.getTime() !== source.createdAt.getTime()) fields.push("createdAt");
  return fields;
}

function identifyConflictingUser(
  source: PreparedUserInsert,
  sourceIndex: number,
  byId: TargetUser | undefined,
  emailMatches: TargetUser[],
): TargetConflict | undefined {
  if (byId) {
    const fields = conflictingFields(byId, source);
    if (fields.length === 0) {
      return emailMatches.length > 1
        ? {
            sourceIndex,
            userId: source.id,
            reason: "email_exists_with_different_user",
            conflictingUserId: emailMatches[0].id,
            conflictingUserIds: emailMatches.map((user) => user.id),
            conflictingFields: ["email"],
          }
        : undefined;
    }
    return {
      sourceIndex,
      userId: source.id,
      reason: "user_id_exists_with_different_data",
      conflictingUserId: byId.id,
      conflictingUserIds: [...new Set([byId.id, ...emailMatches.map((user) => user.id)])],
      conflictingFields: fields,
    };
  }
  if (emailMatches.length > 1 || (emailMatches[0] && emailMatches[0].id !== source.id)) {
    return {
      sourceIndex,
      userId: source.id,
      reason: "email_exists_with_different_user",
      conflictingUserId: emailMatches[0].id,
      conflictingUserIds: emailMatches.map((user) => user.id),
      conflictingFields: ["id"],
    };
  }
  return undefined;
}

function getDatabaseErrorCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current instanceof Error; depth += 1) {
    const code = (current as Error & { code?: unknown }).code;
    if (typeof code === "string" && /^[A-Z0-9]{5}$/.test(code)) {
      return code;
    }
    current = (current as Error & { cause?: unknown }).cause;
  }
  return undefined;
}

export async function migrateLegacyIdentityUsers(
  input: unknown,
  database: IdentityDatabase,
  options: { apply?: boolean } = {},
): Promise<IdentityMigrationReport> {
  const mode = options.apply ? "apply" : "dry-run";
  const review = reviewLegacyIdentitySource(input);
  const report = baseReport(mode, review);

  if (hasSourceIssues(review)) {
    return report;
  }

  if (review.validRecords.length === 0) {
    report.status = options.apply ? "completed" : "ready";
    return report;
  }

  try {
    const ids = review.validRecords.map((record) => record.id);
    const emails = review.validRecords.map((record) => record.email);
    const emailPredicate = sql`lower(trim(${users.email})) in (${sql.join(
      emails.map((email) => sql`${email}`),
      sql`, `,
    )})`;
    const targetRows = await database
      .select()
      .from(users)
      .where(or(inArray(users.id, ids), emailPredicate));
    const byId = new Map(targetRows.map((user) => [user.id, user]));
    const byEmail = new Map<string, TargetUser[]>();
    for (const user of targetRows) {
      const email = normalizeIdentityEmail(user.email);
      const matches = byEmail.get(email) ?? [];
      matches.push(user);
      byEmail.set(email, matches);
    }
    const planned: PreparedUserInsert[] = [];

    review.validRecords.forEach((source, index) => {
      const sourceIndex = index + 1;
      const existingById = byId.get(source.id);
      const existingByEmail = byEmail.get(source.email) ?? [];
      const conflict = identifyConflictingUser(source, sourceIndex, existingById, existingByEmail);

      if (conflict) {
        report.targetConflicts.push(conflict);
      } else if (existingById && existingByEmail.some((user) => user.id === source.id)) {
        report.alreadyMigrated += 1;
      } else {
        planned.push(source);
      }
    });

    report.plannedInserts = planned.length;
    report.conflicting = report.targetConflicts.length;
    if (report.targetConflicts.length > 0) {
      return report;
    }

    if (!options.apply) {
      report.status = "ready";
      return report;
    }

    if (planned.length > 0) {
      await database.transaction(async (transaction) => {
        await transaction.insert(users).values(planned);
      });
    }

    report.inserted = planned.length;
    report.status = "completed";
    return report;
  } catch (error) {
    report.status = "failed";
    const code = getDatabaseErrorCode(error);
    if (code) {
      report.failureCode = code;
    }
    return report;
  }
}

export function isDisposableMigrationDatabaseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const loopbackHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
    const databaseName = decodeURIComponent(url.pathname.slice(1));
    return (
      (url.protocol === "postgres:" || url.protocol === "postgresql:") &&
      loopbackHosts.has(url.hostname.toLowerCase()) &&
      /(?:test|disposable)/i.test(databaseName)
    );
  } catch {
    return false;
  }
}
