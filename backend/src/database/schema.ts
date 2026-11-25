import { sql } from "drizzle-orm";
import {
  AnyPgColumn,
  boolean,
  check,
  index,
  inet,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const authUserStatus = pgEnum("auth_user_status", ["active", "suspended", "deleted"]);

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    fullName: text("full_name").notNull(),
    avatarUrl: text("avatar_url"),
    status: authUserStatus("status").notNull().default("active"),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true, mode: "date" }),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("users_email_lower_unique").on(sql`lower(${table.email})`),
    check("users_email_not_blank", sql`length(trim(${table.email})) > 0`),
    check("users_full_name_not_blank", sql`length(trim(${table.fullName})) > 0`),
    index("users_status_idx").on(table.status),
  ],
);

export const authSessions = pgTable(
  "auth_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    familyId: uuid("family_id").notNull().defaultRandom(),
    refreshTokenHash: text("refresh_token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
    revokedReason: text("revoked_reason"),
    replacedBySessionId: uuid("replaced_by_session_id").references(
      (): AnyPgColumn => authSessions.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true, mode: "date" }),
    ipAddress: inet("ip_address"),
    userAgent: text("user_agent"),
  },
  (table) => [
    uniqueIndex("auth_sessions_refresh_token_hash_unique").on(table.refreshTokenHash),
    uniqueIndex("auth_sessions_replaced_by_session_unique").on(table.replacedBySessionId),
    index("auth_sessions_user_id_idx").on(table.userId),
    index("auth_sessions_family_id_idx").on(table.familyId),
    index("auth_sessions_expiry_idx").on(table.expiresAt),
    check("auth_sessions_expiry_after_creation", sql`${table.expiresAt} > ${table.createdAt}`),
  ],
);

export const emailVerificationTokens = pgTable(
  "email_verification_tokens",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("email_verification_tokens_hash_unique").on(table.tokenHash),
    index("email_verification_tokens_user_created_idx").on(table.userId, table.createdAt),
    index("email_verification_tokens_expiry_idx").on(table.expiresAt),
    check("email_verification_tokens_expiry_after_creation", sql`${table.expiresAt} > ${table.createdAt}`),
  ],
);

export const passwordResetTokens = pgTable(
  "password_reset_tokens",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("password_reset_tokens_hash_unique").on(table.tokenHash),
    index("password_reset_tokens_user_created_idx").on(table.userId, table.createdAt),
    index("password_reset_tokens_expiry_idx").on(table.expiresAt),
    check("password_reset_tokens_expiry_after_creation", sql`${table.expiresAt} > ${table.createdAt}`),
  ],
);

export const authAuditEvents = pgTable(
  "auth_audit_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    eventType: text("event_type").notNull(),
    succeeded: boolean("succeeded").notNull(),
    ipAddress: inet("ip_address"),
    userAgent: text("user_agent"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("auth_audit_events_user_created_idx").on(table.userId, table.createdAt),
    index("auth_audit_events_type_created_idx").on(table.eventType, table.createdAt),
    check(
      "auth_audit_events_metadata_object_and_size",
      sql`jsonb_typeof(${table.metadata}) = 'object' and octet_length(${table.metadata}::text) <= 4096`,
    ),
  ],
);

export const identitySchema = {
  users,
  authSessions,
  emailVerificationTokens,
  passwordResetTokens,
  authAuditEvents,
};
