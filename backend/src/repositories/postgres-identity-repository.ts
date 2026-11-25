import { and, eq, isNull, sql } from "drizzle-orm";
import { getDatabase, type IdentityDatabase } from "../database/client.js";
import {
  authAuditEvents,
  authSessions,
  emailVerificationTokens,
  passwordResetTokens,
  users,
} from "../database/schema.js";

export async function findIdentityUserById(
  id: string,
  database: IdentityDatabase = getDatabase(),
) {
  const [user] = await database.select().from(users).where(eq(users.id, id)).limit(1);
  return user ?? null;
}

export async function findIdentityUserByEmail(
  email: string,
  database: IdentityDatabase = getDatabase(),
) {
  const normalizedEmail = email.trim().toLowerCase();
  const [user] = await database
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = ${normalizedEmail}`)
    .limit(1);
  return user ?? null;
}

export async function createIdentityUser(
  values: typeof users.$inferInsert,
  database: IdentityDatabase = getDatabase(),
) {
  const normalizedValues = { ...values, email: values.email.trim().toLowerCase() };
  const [user] = await database
    .insert(users)
    .values(normalizedValues)
    .returning();
  return user;
}

export async function updateIdentityUserProfile(
  id: string,
  profile: Partial<Pick<typeof users.$inferInsert, "fullName" | "avatarUrl">>,
  database: IdentityDatabase = getDatabase(),
) {
  const [user] = await database
    .update(users)
    .set({ ...profile, updatedAt: new Date() })
    .where(eq(users.id, id))
    .returning();
  return user ?? null;
}

export async function createAuthSession(
  values: typeof authSessions.$inferInsert,
  database: IdentityDatabase = getDatabase(),
) {
  const [session] = await database.insert(authSessions).values(values).returning();
  return session;
}

export async function findAuthSessionByRefreshTokenHash(
  tokenHash: string,
  database: IdentityDatabase = getDatabase(),
) {
  const [session] = await database
    .select()
    .from(authSessions)
    .where(eq(authSessions.refreshTokenHash, tokenHash))
    .limit(1);
  return session ?? null;
}

export async function revokeAuthSession(
  id: string,
  reason: string,
  revokedAt = new Date(),
  database: IdentityDatabase = getDatabase(),
) {
  const [session] = await database
    .update(authSessions)
    .set({ revokedAt, revokedReason: reason })
    .where(and(eq(authSessions.id, id), isNull(authSessions.revokedAt)))
    .returning();
  return session ?? null;
}

export async function revokeAuthSessionFamily(
  familyId: string,
  reason: string,
  revokedAt = new Date(),
  database: IdentityDatabase = getDatabase(),
) {
  return database
    .update(authSessions)
    .set({ revokedAt, revokedReason: reason })
    .where(and(eq(authSessions.familyId, familyId), isNull(authSessions.revokedAt)))
    .returning();
}

export async function createEmailVerificationToken(
  values: typeof emailVerificationTokens.$inferInsert,
  database: IdentityDatabase = getDatabase(),
) {
  const [token] = await database.insert(emailVerificationTokens).values(values).returning();
  return token;
}

export async function findEmailVerificationTokenByHash(
  tokenHash: string,
  database: IdentityDatabase = getDatabase(),
) {
  const [token] = await database
    .select()
    .from(emailVerificationTokens)
    .where(eq(emailVerificationTokens.tokenHash, tokenHash))
    .limit(1);
  return token ?? null;
}

export async function consumeEmailVerificationToken(
  id: string,
  consumedAt = new Date(),
  database: IdentityDatabase = getDatabase(),
) {
  const [token] = await database
    .update(emailVerificationTokens)
    .set({ consumedAt })
    .where(and(eq(emailVerificationTokens.id, id), isNull(emailVerificationTokens.consumedAt)))
    .returning();
  return token ?? null;
}

export async function createPasswordResetToken(
  values: typeof passwordResetTokens.$inferInsert,
  database: IdentityDatabase = getDatabase(),
) {
  const [token] = await database.insert(passwordResetTokens).values(values).returning();
  return token;
}

export async function findPasswordResetTokenByHash(
  tokenHash: string,
  database: IdentityDatabase = getDatabase(),
) {
  const [token] = await database
    .select()
    .from(passwordResetTokens)
    .where(eq(passwordResetTokens.tokenHash, tokenHash))
    .limit(1);
  return token ?? null;
}

export async function consumePasswordResetToken(
  id: string,
  consumedAt = new Date(),
  database: IdentityDatabase = getDatabase(),
) {
  const [token] = await database
    .update(passwordResetTokens)
    .set({ consumedAt })
    .where(and(eq(passwordResetTokens.id, id), isNull(passwordResetTokens.consumedAt)))
    .returning();
  return token ?? null;
}

export async function createAuthAuditEvent(
  values: typeof authAuditEvents.$inferInsert,
  database: IdentityDatabase = getDatabase(),
) {
  const [event] = await database.insert(authAuditEvents).values(values).returning();
  return event;
}
