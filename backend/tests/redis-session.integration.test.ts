import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { RedisTransientStore } from "../src/auth/transient-store.js";
import { EphemeralSuccessorVault } from "../src/auth/successor-vault.js";
import { SessionService } from "../src/repositories/session-service.js";
import { createDatabaseConnection, type IdentityDatabase } from "../src/database/client.js";
import { authSessionFamilies, users } from "../src/database/schema.js";
import { createIdentityUser } from "../src/repositories/postgres-identity-repository.js";
import { eq } from "drizzle-orm";
import { AuthErrorCode } from "../src/auth/errors.js";

const testRedisUrl = process.env.TEST_REDIS_URL || process.env.REDIS_URL;
const testDatabaseUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
const isCi = process.env.CI === "true";

describe.skipIf((!testRedisUrl || !testDatabaseUrl) && !isCi)(
  "Real Redis & PostgreSQL Session Integration Suite",
  () => {
    let database: IdentityDatabase | undefined;
    let closeDatabase: (() => Promise<void>) | undefined;
    let redisStoreNodeA: RedisTransientStore | undefined;
    let redisStoreNodeB: RedisTransientStore | undefined;
    let testUserId: string;
    const persistentVaultKey = randomBytes(32);

    beforeAll(async () => {
      if (!testDatabaseUrl || !testRedisUrl) {
        throw new Error("TEST_DATABASE_URL and TEST_REDIS_URL are required for this suite.");
      }

      const connection = createDatabaseConnection({
        DATABASE_URL: testDatabaseUrl,
        DATABASE_SSL: process.env.DATABASE_SSL,
        NODE_ENV: process.env.NODE_ENV,
      });
      database = connection.database;
      closeDatabase = connection.close;

      redisStoreNodeA = new RedisTransientStore(testRedisUrl);
      redisStoreNodeB = new RedisTransientStore(testRedisUrl);

      testUserId = randomUUID();
      await createIdentityUser(
        {
          id: testUserId,
          email: `real-redis-${testUserId}@example.test`,
          passwordHash: "$2b$10$real-redis-test-hash",
          fullName: "Real Redis Integration User",
        },
        database
      );
    });

    afterAll(async () => {
      if (database && testUserId) {
        await database.delete(users).where(eq(users.id, testUserId));
      }
      await redisStoreNodeA?.close?.();
      await redisStoreNodeB?.close?.();
      await closeDatabase?.();
    });

    it("executes multi-instance retry: rotated on Node A, recovered via real Redis on Node B", async () => {
      if (!database || !redisStoreNodeA || !redisStoreNodeB) throw new Error("Uninitialized");

      const vaultA = new EphemeralSuccessorVault(persistentVaultKey, redisStoreNodeA);
      const vaultB = new EphemeralSuccessorVault(persistentVaultKey, redisStoreNodeB);

      const serviceA = new SessionService(database, vaultA);
      const serviceB = new SessionService(database, vaultB);

      const absoluteExpiry = new Date(Date.now() + 30 * 86400 * 1000);
      const { familyId, rawRefreshToken: token1 } = await serviceA.createSessionFamily({
        userId: testUserId,
        absoluteExpiresAt: absoluteExpiry,
        deviceLabel: "Integration Test Device",
      });

      const idemKey = randomUUID();

      // Node A rotates token
      const rotation1 = await serviceA.rotateRefreshToken({
        rawRefreshToken: token1,
        idempotencyKey: idemKey,
      });

      expect(rotation1.isRetry).toBe(false);
      const token2 = rotation1.rawRefreshToken;

      // Node B receives the retry request and recovers from real Redis
      const retryOnNodeB = await serviceB.rotateRefreshToken({
        rawRefreshToken: token1,
        idempotencyKey: idemKey,
      });

      expect(retryOnNodeB.isRetry).toBe(true);
      expect(retryOnNodeB.rawRefreshToken).toBe(token2);
      expect(retryOnNodeB.familyId).toBe(familyId);
    });

    it("recovers from PostgreSQL when Redis contains corrupted cache entry without false replay revocation", async () => {
      if (!database || !redisStoreNodeA) throw new Error("Uninitialized");

      const vaultA = new EphemeralSuccessorVault(persistentVaultKey, redisStoreNodeA);
      const serviceA = new SessionService(database, vaultA);

      const absoluteExpiry = new Date(Date.now() + 30 * 86400 * 1000);
      const { familyId, rawRefreshToken: token1 } = await serviceA.createSessionFamily({
        userId: testUserId,
        absoluteExpiresAt: absoluteExpiry,
      });

      const idemKey = randomUUID();

      // Rotate token
      const rotation = await serviceA.rotateRefreshToken({
        rawRefreshToken: token1,
        idempotencyKey: idemKey,
      });
      const token2 = rotation.rawRefreshToken;

      // Corrupt the key in real Redis directly
      const tokenHash = (await import("../src/auth/refresh-token.js")).hashRefreshToken(token1);
      const storageKey = vaultA.deriveStorageKey(tokenHash, idemKey);
      await redisStoreNodeA.set(storageKey, "{ corrupted json: invalid! ]", 30);

      // Perform retry: Redis corruption must be quarantined/deleted, and successor recovered from PostgreSQL!
      const recoveredRetry = await serviceA.rotateRefreshToken({
        rawRefreshToken: token1,
        idempotencyKey: idemKey,
      });

      expect(recoveredRetry.isRetry).toBe(true);
      expect(recoveredRetry.rawRefreshToken).toBe(token2);

      // Confirm session family was NOT revoked
      const [family] = await database
        .select()
        .from(authSessionFamilies)
        .where(eq(authSessionFamilies.id, familyId));
      expect(family.revokedAt).toBeNull();
    });

    it("recovers from PostgreSQL when Redis is completely unavailable on retry", async () => {
      if (!database || !redisStoreNodeA) throw new Error("Uninitialized");

      const vaultA = new EphemeralSuccessorVault(persistentVaultKey, redisStoreNodeA);
      const serviceA = new SessionService(database, vaultA);

      const absoluteExpiry = new Date(Date.now() + 30 * 86400 * 1000);
      const { familyId, rawRefreshToken: token1 } = await serviceA.createSessionFamily({
        userId: testUserId,
        absoluteExpiresAt: absoluteExpiry,
      });

      const idemKey = randomUUID();

      // Rotate token
      const rotation = await serviceA.rotateRefreshToken({
        rawRefreshToken: token1,
        idempotencyKey: idemKey,
      });
      const token2 = rotation.rawRefreshToken;

      // Simulate Redis outage on retry by pointing service to an unavailable transient store
      const brokenStore = {
        async get() {
          return { outcome: "UNAVAILABLE" as const, error: "ECONNREFUSED" };
        },
        async set() {
          return { outcome: "UNAVAILABLE" as const, error: "ECONNREFUSED" };
        },
        async del() {
          return { outcome: "UNAVAILABLE" as const, error: "ECONNREFUSED" };
        },
      };

      const outageVault = new EphemeralSuccessorVault(persistentVaultKey, brokenStore);
      const outageService = new SessionService(database, outageVault);

      // Retry during Redis outage must recover seamlessly from PostgreSQL
      const outageRetry = await outageService.rotateRefreshToken({
        rawRefreshToken: token1,
        idempotencyKey: idemKey,
      });

      expect(outageRetry.isRetry).toBe(true);
      expect(outageRetry.rawRefreshToken).toBe(token2);

      // Family remains active
      const [family] = await database
        .select()
        .from(authSessionFamilies)
        .where(eq(authSessionFamilies.id, familyId));
      expect(family.revokedAt).toBeNull();
    });

    it("confirms replay and revokes family when already-consumed token is presented with different idempotency key", async () => {
      if (!database || !redisStoreNodeA) throw new Error("Uninitialized");

      const vaultA = new EphemeralSuccessorVault(persistentVaultKey, redisStoreNodeA);
      const serviceA = new SessionService(database, vaultA);

      const absoluteExpiry = new Date(Date.now() + 30 * 86400 * 1000);
      const { familyId, rawRefreshToken: token1 } = await serviceA.createSessionFamily({
        userId: testUserId,
        absoluteExpiresAt: absoluteExpiry,
      });

      const legitIdemKey = randomUUID();
      await serviceA.rotateRefreshToken({
        rawRefreshToken: token1,
        idempotencyKey: legitIdemKey,
      });

      // Attacker presents token1 with different idempotency key
      let caughtError: any;
      try {
        await serviceA.rotateRefreshToken({
          rawRefreshToken: token1,
          idempotencyKey: "adversary-different-idem-key",
        });
      } catch (err: any) {
        caughtError = err;
      }

      expect(caughtError).toBeDefined();
      expect(caughtError.code).toBe(AuthErrorCode.REFRESH_TOKEN_REUSE);

      // Verify family revoked on true replay
      const [family] = await database
        .select()
        .from(authSessionFamilies)
        .where(eq(authSessionFamilies.id, familyId));
      expect(family.revokedAt).not.toBeNull();
      expect(family.revokedReason).toBe("replay_detected");
    });
  }
);
