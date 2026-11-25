import { randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDatabaseConnection, type IdentityDatabase } from "../src/database/client.js";
import {
  authAuditEvents,
  authRefreshTokens,
  authSessionFamilies,
  authSessions,
  emailVerificationTokens,
  passwordResetTokens,
  users,
} from "../src/database/schema.js";
import { checkDatabaseHealth } from "../src/database/health.js";
import { verifyPassword } from "../src/db.js";
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
import { SessionService } from "../src/repositories/session-service.js";
import { EphemeralSuccessorVault } from "../src/auth/successor-vault.js";
import { AuthErrorCode } from "../src/auth/errors.js";
import { eq, inArray, sql } from "drizzle-orm";
import { migrateLegacyIdentityUsers } from "../src/migrations/json-identity-migration.js";

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

  it("reconciles JSON identities, preserves source fields, and rolls back failed batches", async () => {
    if (!database) {
      throw new Error("PostgreSQL integration test connection was not initialized.");
    }

    const db = database;
    const firstId = randomUUID();
    const secondId = randomUUID();
    const passwordHash = await bcrypt.hash("migration-preparation-test-only", 4);
    const createdAt = "2024-02-03T04:05:06.000Z";
    const sourceUsers = [
      {
        id: firstId,
        email: `  Migration-${firstId}@Example.Test `,
        passwordHash,
        fullName: "Migration User One",
        createdAt,
      },
      {
        id: secondId,
        email: `migration-${secondId}@example.test`,
        passwordHash,
        fullName: "Migration User Two",
        avatarUrl: "https://example.test/avatar.png",
        createdAt,
      },
    ];

    try {
      const firstDryRun = await migrateLegacyIdentityUsers(sourceUsers, db);
      const repeatedDryRun = await migrateLegacyIdentityUsers(sourceUsers, db);
      expect(firstDryRun).toMatchObject({
        status: "ready",
        sourceTotal: 2,
        validRecords: 2,
        plannedInserts: 2,
        inserted: 0,
        rejected: 0,
        conflicting: 0,
      });
      expect(repeatedDryRun).toMatchObject({ status: "ready", plannedInserts: 2, inserted: 0 });
      expect(JSON.stringify(firstDryRun)).not.toContain(passwordHash);
      expect(await db.select().from(users).where(inArray(users.id, [firstId, secondId]))).toHaveLength(0);

      const applied = await migrateLegacyIdentityUsers(sourceUsers, db, { apply: true });
      expect(applied).toMatchObject({ status: "completed", plannedInserts: 2, inserted: 2 });
      expect(JSON.stringify(applied)).not.toContain(passwordHash);

      const migrated = await db.select().from(users).where(inArray(users.id, [firstId, secondId]));
      expect(migrated).toHaveLength(2);
      const first = migrated.find((user) => user.id === firstId);
      expect(first).toMatchObject({
        id: firstId,
        email: `migration-${firstId}@example.test`,
        fullName: "Migration User One",
        avatarUrl: null,
        status: "active",
        emailVerifiedAt: null,
        lastLoginAt: null,
      });
      expect(first?.passwordHash === passwordHash).toBe(true);
      expect(await verifyPassword("migration-preparation-test-only", first?.passwordHash ?? "")).toBe(true);
      expect(first?.createdAt.toISOString()).toBe(createdAt);
      expect(migrated.find((user) => user.id === secondId)?.avatarUrl).toBe(
        "https://example.test/avatar.png",
      );

      const repeatedApply = await migrateLegacyIdentityUsers(sourceUsers, db, { apply: true });
      expect(repeatedApply).toMatchObject({
        status: "completed",
        alreadyMigrated: 2,
        plannedInserts: 0,
        inserted: 0,
      });

      const duplicateSource = [
        { ...sourceUsers[0], id: randomUUID() },
        { ...sourceUsers[1], id: randomUUID(), email: sourceUsers[0].email.toUpperCase() },
      ];
      const duplicateReport = await migrateLegacyIdentityUsers(duplicateSource, db, { apply: true });
      expect(duplicateReport.status).toBe("blocked");
      expect(duplicateReport.duplicateNormalizedEmails).toHaveLength(1);
      expect(duplicateReport.inserted).toBe(0);
      expect(duplicateReport.rejected).toBe(2);

      const malformedReport = await migrateLegacyIdentityUsers(
        [{ ...sourceUsers[0], id: "invalid-id" }],
        db,
        { apply: true },
      );
      expect(malformedReport.status).toBe("blocked");
      expect(malformedReport.malformedRecords).toHaveLength(1);
      expect(malformedReport.inserted).toBe(0);
      expect(malformedReport.rejected).toBe(1);

      const conflictId = randomUUID();
      const conflictEmail = `migration-conflict-${conflictId}@example.test`;
      const conflictingTarget = await createIdentityUser(
        {
          email: conflictEmail,
          passwordHash,
          fullName: "Existing Target User",
        },
        db,
      );
      try {
        const conflictReport = await migrateLegacyIdentityUsers(
          [{
            ...sourceUsers[0],
            id: conflictId,
            email: conflictEmail.toUpperCase(),
          }],
          db,
          { apply: true },
        );
        expect(conflictReport).toMatchObject({
          status: "blocked",
          inserted: 0,
          conflicting: 1,
          targetConflicts: [{
            reason: "email_exists_with_different_user",
            conflictingUserId: conflictingTarget.id,
            conflictingFields: ["id"],
          }],
        });
        expect(await db.select().from(users).where(eq(users.id, conflictingTarget.id))).toHaveLength(1);
      } finally {
        await db.delete(users).where(eq(users.id, conflictingTarget.id));
      }

      const passwordConflictId = randomUUID();
      const passwordConflictEmail = `migration-password-conflict-${passwordConflictId}@example.test`;
      const originalPasswordHash = await bcrypt.hash("migration-existing-password-only", 4);
      const changedPasswordHash = await bcrypt.hash("migration-source-password-only", 4);
      const passwordConflictTarget = await createIdentityUser(
        {
          id: passwordConflictId,
          email: passwordConflictEmail,
          passwordHash: originalPasswordHash,
          fullName: "Migration User One",
          createdAt: new Date(createdAt),
          updatedAt: new Date(createdAt),
        },
        db,
      );
      try {
        const passwordConflictReport = await migrateLegacyIdentityUsers(
          [{
            ...sourceUsers[0],
            id: passwordConflictId,
            email: passwordConflictEmail,
            passwordHash: changedPasswordHash,
          }],
          db,
          { apply: true },
        );
        expect(passwordConflictReport).toMatchObject({
          status: "blocked",
          inserted: 0,
          conflicting: 1,
          targetConflicts: [{
            reason: "user_id_exists_with_different_data",
            conflictingFields: ["passwordHash"],
          }],
        });
        const [unchangedPassword] = await db
          .select()
          .from(users)
          .where(eq(users.id, passwordConflictTarget.id));
        expect(unchangedPassword.passwordHash === originalPasswordHash).toBe(true);
      } finally {
        await db.delete(users).where(eq(users.id, passwordConflictTarget.id));
      }

      const uuidConflictId = randomUUID();
      const uuidConflictTarget = await createIdentityUser(
        {
          id: uuidConflictId,
          email: `migration-existing-${uuidConflictId}@example.test`,
          passwordHash,
          fullName: "Migration User One",
          createdAt: new Date(createdAt),
          updatedAt: new Date(createdAt),
        },
        db,
      );
      try {
        const uuidConflictReport = await migrateLegacyIdentityUsers(
          [{
            ...sourceUsers[0],
            id: uuidConflictId,
            email: `migration-new-${uuidConflictId}@example.test`,
          }],
          db,
          { apply: true },
        );
        expect(uuidConflictReport).toMatchObject({
          status: "blocked",
          inserted: 0,
          conflicting: 1,
          targetConflicts: [{
            reason: "user_id_exists_with_different_data",
            conflictingFields: ["email"],
          }],
        });
        expect(await db.select().from(users).where(eq(users.id, uuidConflictTarget.id))).toHaveLength(1);
      } finally {
        await db.delete(users).where(eq(users.id, uuidConflictTarget.id));
      }

      const rollbackFirstId = randomUUID();
      const rollbackSecondId = randomUUID();
      const rollbackUsers = [
        {
          ...sourceUsers[0],
          id: rollbackFirstId,
          email: `rollback-first-${rollbackFirstId}@example.test`,
        },
        {
          ...sourceUsers[1],
          id: rollbackSecondId,
          email: `rollback-fail-${rollbackSecondId}@example.test`,
        },
      ];

      try {
        await db.execute(sql`
          ALTER TABLE users
          ADD CONSTRAINT json_identity_migration_rollback_check
          CHECK (email NOT LIKE 'rollback-fail-%@example.test')
        `);

        const failedBatch = await migrateLegacyIdentityUsers(rollbackUsers, db, { apply: true });
        expect(failedBatch).toMatchObject({ status: "failed", failureCode: "23514", inserted: 0 });
        expect(
          await db
            .select()
            .from(users)
            .where(inArray(users.id, [rollbackFirstId, rollbackSecondId])),
        ).toHaveLength(0);
      } finally {
        await db.execute(sql`ALTER TABLE users DROP CONSTRAINT IF EXISTS json_identity_migration_rollback_check`);
        await db.delete(users).where(inArray(users.id, [rollbackFirstId, rollbackSecondId]));
      }
    } finally {
      await db.delete(users).where(inArray(users.id, [firstId, secondId]));
    }
  });

  it("manages dedicated session families, refresh rotation, idempotent retries, and replay detection", async () => {
    if (!database) {
      throw new Error("PostgreSQL integration test connection was not initialized.");
    }

    const db = database;
    const testUserId = randomUUID();
    await createIdentityUser(
      {
        id: testUserId,
        email: `session-test-${testUserId}@example.test`,
        passwordHash: "$2b$10$test-session-hash-only",
        fullName: "Session Test User",
      },
      db
    );

    const vaultKey = randomBytes(32);
    const vault = new EphemeralSuccessorVault(vaultKey, new InMemoryTransientStore());
    const sessionService = new SessionService(db, vault);

    try {
      // 1. Create session family
      const absoluteExpiry = new Date(Date.now() + 30 * 86400 * 1000); // 30 days
      const { familyId, rawRefreshToken: token1 } = await sessionService.createSessionFamily({
        userId: testUserId,
        absoluteExpiresAt: absoluteExpiry,
        deviceLabel: "Chrome on macOS",
        initialIpAddress: "127.0.0.1",
        initialUserAgent: "Mozilla/5.0",
      });

      expect(familyId).toBeDefined();
      expect(token1).toBeDefined();

      const [storedFamily] = await db
        .select()
        .from(authSessionFamilies)
        .where(eq(authSessionFamilies.id, familyId));
      expect(storedFamily).toBeDefined();
      expect(storedFamily.userId).toBe(testUserId);
      expect(storedFamily.deviceLabel).toBe("Chrome on macOS");

      // 2. Rotate refresh token with idempotency key
      const idemKey = randomUUID();
      const rotation1 = await sessionService.rotateRefreshToken({
        rawRefreshToken: token1,
        idempotencyKey: idemKey,
      });

      expect(rotation1.isRetry).toBe(false);
      expect(rotation1.familyId).toBe(familyId);
      expect(rotation1.rawRefreshToken).toBeDefined();
      expect(rotation1.rawRefreshToken).not.toBe(token1);

      const token2 = rotation1.rawRefreshToken;

      // 3. Lost-response retry with SAME token1 and SAME idempotency key within 30s
      const retryResult = await sessionService.rotateRefreshToken({
        rawRefreshToken: token1,
        idempotencyKey: idemKey,
      });

      expect(retryResult.isRetry).toBe(true);
      expect(retryResult.rawRefreshToken).toBe(token2); // Re-issued identical successor!

      // 3b. Verify PostgreSQL authoritative retry recovery when Redis/transient vault fails or misses
      // Create a fresh session service pointing to an empty/broken vault (simulating Redis outage on retry)
      const emptyVault = new EphemeralSuccessorVault(vault.getVaultKey(), new InMemoryTransientStore());
      const sessionServiceWithEmptyVault = new SessionService(db, emptyVault);

      const dbRetryResult = await sessionServiceWithEmptyVault.rotateRefreshToken({
        rawRefreshToken: token1,
        idempotencyKey: idemKey,
      });
      expect(dbRetryResult.isRetry).toBe(true);
      expect(dbRetryResult.rawRefreshToken).toBe(token2); // Successfully recovered from PostgreSQL authoritative record!

      // 4. Replay attack attempt: presenting already-consumed token1 with DIFFERENT idempotency key (or none)
      let replayError: any;
      try {
        await sessionService.rotateRefreshToken({
          rawRefreshToken: token1,
          idempotencyKey: "different-attacker-idem-key",
        });
      } catch (err: any) {
        replayError = err;
      }

      expect(replayError).toBeDefined();
      expect(replayError.code).toBe(AuthErrorCode.REFRESH_TOKEN_REUSE);

      // Verify entire family is revoked due to replay detection!
      const [revokedFamily] = await db
        .select()
        .from(authSessionFamilies)
        .where(eq(authSessionFamilies.id, familyId));
      expect(revokedFamily.revokedAt).not.toBeNull();
      expect(revokedFamily.revokedReason).toBe("replay_detected");

      // 5. Successor token2 must now also be rejected because family is revoked
      await expect(
        sessionService.rotateRefreshToken({
          rawRefreshToken: token2,
        })
      ).rejects.toMatchObject({ code: AuthErrorCode.REVOKED_TOKEN });
    } finally {
      await db.delete(users).where(eq(users.id, testUserId));
    }
  });
});
