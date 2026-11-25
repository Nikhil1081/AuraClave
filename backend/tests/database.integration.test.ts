import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDatabaseConnection, type IdentityDatabase } from "../src/database/client.js";
import {
  authAuditEvents,
  authSessions,
  emailVerificationTokens,
  passwordResetTokens,
  users,
} from "../src/database/schema.js";
import { checkDatabaseHealth } from "../src/database/health.js";
import {
  consumeEmailVerificationToken,
  consumePasswordResetToken,
  createAuthAuditEvent,
  createAuthSession,
  createEmailVerificationToken,
  createIdentityUser,
  createPasswordResetToken,
  findAuthSessionByRefreshTokenHash,
  findEmailVerificationTokenByHash,
  findIdentityUserByEmail,
  findIdentityUserById,
  findPasswordResetTokenByHash,
  revokeAuthSession,
  updateIdentityUserProfile,
} from "../src/repositories/postgres-identity-repository.js";
import { eq } from "drizzle-orm";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const isCi = process.env.CI === "true";

describe.skipIf(!testDatabaseUrl && !isCi)("PostgreSQL identity repository", () => {
  let database: IdentityDatabase | undefined;
  let closeDatabase: (() => Promise<void>) | undefined;
  let userId: string | undefined;
  let auditEventId: string | undefined;

  beforeAll(async () => {
    if (!testDatabaseUrl) {
      throw new Error("TEST_DATABASE_URL is required for PostgreSQL integration tests.");
    }

    const connection = createDatabaseConnection({
      DATABASE_URL: testDatabaseUrl,
      DATABASE_SSL: process.env.DATABASE_SSL,
      NODE_ENV: process.env.NODE_ENV,
    });
    database = connection.database;
    closeDatabase = connection.close;
    await migrate(connection.database, {
      migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
    });
    await checkDatabaseHealth(connection.database);
  });

  afterAll(async () => {
    if (auditEventId && database) {
      await database.delete(authAuditEvents).where(eq(authAuditEvents.id, auditEventId));
    }
    if (userId && database) {
      await database.delete(users).where(eq(users.id, userId));
    }
    await closeDatabase?.();
  });

  it("persists identity records, tokens, sessions, and audit events", async () => {
    if (!database) {
      throw new Error("PostgreSQL integration test connection was not initialized.");
    }

    const db = database;
    const uniqueId = randomUUID();
    const email = `identity-${uniqueId}@example.test`;
    const user = await createIdentityUser(
      {
        email: email.toUpperCase(),
        passwordHash: "$2b$10$test-hash-not-used-for-auth",
        fullName: "Integration Test",
      },
      db,
    );
    userId = user.id;

    expect(user.email).toBe(email.toLowerCase());
    expect(user.lastLoginAt).toBeNull();
    expect(await findIdentityUserById(user.id, db)).toMatchObject({ id: user.id });
    expect(await findIdentityUserByEmail(email.toUpperCase(), db)).toMatchObject({
      id: user.id,
    });

    await expect(
      db
        .insert(users)
        .values({
          email: email.toUpperCase(),
          passwordHash: "$2b$10$duplicate-user",
          fullName: "Duplicate",
        })
        .returning(),
    ).rejects.toMatchObject({ cause: { code: "23505" } });

    const missingUserId = randomUUID();
    const expiresAt = new Date(Date.now() + 60_000);
    await expect(
      db.insert(authSessions).values({
        userId: missingUserId,
        refreshTokenHash: `orphan-session:${uniqueId}`,
        expiresAt,
      }),
    ).rejects.toMatchObject({ cause: { code: "23503" } });
    await expect(
      db.insert(emailVerificationTokens).values({
        userId: missingUserId,
        tokenHash: `orphan-verify:${uniqueId}`,
        expiresAt,
      }),
    ).rejects.toMatchObject({ cause: { code: "23503" } });
    await expect(
      db.insert(passwordResetTokens).values({
        userId: missingUserId,
        tokenHash: `orphan-reset:${uniqueId}`,
        expiresAt,
      }),
    ).rejects.toMatchObject({ cause: { code: "23503" } });
    await expect(
      db.insert(authAuditEvents).values({
        userId: missingUserId,
        eventType: "orphan_test",
        succeeded: false,
      }),
    ).rejects.toMatchObject({ cause: { code: "23503" } });

    expect(
      await updateIdentityUserProfile(
        user.id,
        { fullName: "Updated Integration Test", avatarUrl: null },
        db,
      ),
    ).toMatchObject({ fullName: "Updated Integration Test" });

    const session = await createAuthSession(
      {
        userId: user.id,
        refreshTokenHash: `sha256:${uniqueId}`,
        expiresAt: new Date(Date.now() + 60_000),
      },
      db,
    );
    expect(await findAuthSessionByRefreshTokenHash(session.refreshTokenHash, db)).toMatchObject({
      id: session.id,
    });
    expect(await revokeAuthSession(session.id, "test_logout", new Date(), db)).toMatchObject({
      revokedReason: "test_logout",
    });
    expect(await revokeAuthSession(session.id, "test_logout", new Date(), db)).toBeNull();

    const verificationToken = await createEmailVerificationToken(
      {
        userId: user.id,
        tokenHash: `verify:${uniqueId}`,
        expiresAt: new Date(Date.now() + 60_000),
      },
      db,
    );
    expect(await findEmailVerificationTokenByHash(verificationToken.tokenHash, db)).toMatchObject({
      id: verificationToken.id,
    });
    expect(await consumeEmailVerificationToken(verificationToken.id, new Date(), db)).not.toBeNull();
    expect(await consumeEmailVerificationToken(verificationToken.id, new Date(), db)).toBeNull();

    const resetToken = await createPasswordResetToken(
      {
        userId: user.id,
        tokenHash: `reset:${uniqueId}`,
        expiresAt: new Date(Date.now() + 60_000),
      },
      db,
    );
    expect(await findPasswordResetTokenByHash(resetToken.tokenHash, db)).toMatchObject({
      id: resetToken.id,
    });
    expect(await consumePasswordResetToken(resetToken.id, new Date(), db)).not.toBeNull();
    expect(await consumePasswordResetToken(resetToken.id, new Date(), db)).toBeNull();

    const auditEvent = await createAuthAuditEvent(
      {
        userId: user.id,
        eventType: "integration_test",
        succeeded: true,
        metadata: { test: true },
      },
      db,
    );
    auditEventId = auditEvent.id;
    expect(auditEvent).toMatchObject({ userId: user.id, eventType: "integration_test" });

    await db.delete(users).where(eq(users.id, user.id));
    userId = undefined;

    expect(await db.select().from(authSessions).where(eq(authSessions.id, session.id))).toHaveLength(0);
    expect(
      await db
        .select()
        .from(emailVerificationTokens)
        .where(eq(emailVerificationTokens.id, verificationToken.id)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(passwordResetTokens)
        .where(eq(passwordResetTokens.id, resetToken.id)),
    ).toHaveLength(0);
    const [auditEventAfterUserDeletion] = await db
      .select()
      .from(authAuditEvents)
      .where(eq(authAuditEvents.id, auditEvent.id));
    expect(auditEventAfterUserDeletion.userId).toBeNull();
    await db.delete(authAuditEvents).where(eq(authAuditEvents.id, auditEvent.id));
    auditEventId = undefined;
  });
});
