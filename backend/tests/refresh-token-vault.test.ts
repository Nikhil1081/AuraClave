import { describe, expect, it } from "vitest";
import crypto from "crypto";
import { generateOpaqueRefreshToken, hashRefreshToken } from "../src/auth/refresh-token.js";
import {
  EphemeralSuccessorVault,
  createSuccessorVaultFromConfig,
} from "../src/auth/successor-vault.js";
import {
  InMemoryTransientStore,
  TransientStoreOutcome,
} from "../src/auth/transient-store.js";

describe("M1.4.4 Refresh Token Generation & Distributed Successor Vault", () => {
  const testKey = crypto.randomBytes(32);

  it("generates opaque refresh tokens with 256 bits of entropy and SHA-256 digests", () => {
    const { rawToken, tokenHash } = generateOpaqueRefreshToken();
    expect(typeof rawToken).toBe("string");
    expect(rawToken.length).toBeGreaterThan(40); // base64url 32 bytes = 43 chars
    expect(tokenHash).toHaveLength(64); // SHA-256 hex string = 64 hex chars
    expect(hashRefreshToken(rawToken)).toBe(tokenHash);
  });

  it("safely stores and retrieves successor responses with FOUND outcome", async () => {
    const vault = new EphemeralSuccessorVault(testKey, new InMemoryTransientStore());
    const tokenHash = "dummy-token-hash-12345";
    const idempotencyKey = "client-uuid-idem-key-1";
    const successorToken = "raw-successor-token-67890";
    const familyId = "family-uuid-1111";

    await vault.storeSuccessor(tokenHash, idempotencyKey, successorToken, familyId, 2); // 2 second TTL

    const cached = await vault.retrieveSuccessor(tokenHash, idempotencyKey);
    expect(cached.outcome).toBe("FOUND");
    if (cached.outcome === "FOUND") {
      expect(cached.payload.rawSuccessorToken).toBe(successorToken);
      expect(cached.payload.familyId).toBe(familyId);
    }
  });

  it("returns NOT_FOUND if idempotency key is different", async () => {
    const vault = new EphemeralSuccessorVault(testKey, new InMemoryTransientStore());
    const tokenHash = "dummy-token-hash-12345";
    const idempotencyKey = "client-uuid-idem-key-1";
    const successorToken = "raw-successor-token-67890";
    const familyId = "family-uuid-1111";

    await vault.storeSuccessor(tokenHash, idempotencyKey, successorToken, familyId, 30);

    const wrongKeyResult = await vault.retrieveSuccessor(tokenHash, "different-idempotency-key");
    expect(wrongKeyResult.outcome).toBe("NOT_FOUND");
  });

  it("returns EXPIRED for cached successor responses past TTL", async () => {
    const vault = new EphemeralSuccessorVault(testKey, new InMemoryTransientStore());
    const tokenHash = "dummy-token-hash-12345";
    const idempotencyKey = "client-uuid-idem-key-1";
    const successorToken = "raw-successor-token-67890";
    const familyId = "family-uuid-1111";

    await vault.storeSuccessor(tokenHash, idempotencyKey, successorToken, familyId, 0.05); // 50ms TTL

    await new Promise((r) => setTimeout(r, 60));

    const expiredResult = await vault.retrieveSuccessor(tokenHash, idempotencyKey);
    expect(expiredResult.outcome).toBe("EXPIRED");
  });

  it("supports multi-instance access: two independent API nodes sharing same transient store", async () => {
    // Shared state simulating a Redis instance accessible to multiple backend servers
    const sharedMap = new Map();
    const sharedStoreNodeA = new InMemoryTransientStore(sharedMap);
    const sharedStoreNodeB = new InMemoryTransientStore(sharedMap);

    // Shared encryption key configured on both API nodes
    const sharedVaultKey = crypto.randomBytes(32);

    const vaultNodeA = new EphemeralSuccessorVault(sharedVaultKey, sharedStoreNodeA);
    const vaultNodeB = new EphemeralSuccessorVault(sharedVaultKey, sharedStoreNodeB);

    const tokenHash = "multi-node-token-hash-abc";
    const idempotencyKey = "multi-node-idem-key-xyz";
    const successorToken = "raw-successor-from-node-a";
    const familyId = "family-uuid-shared";

    // Node A rotates token and stores in shared vault
    await vaultNodeA.storeSuccessor(tokenHash, idempotencyKey, successorToken, familyId, 30);

    // Node B receives the retry request from the client and retrieves the successor
    const retrievedByNodeB = await vaultNodeB.retrieveSuccessor(tokenHash, idempotencyKey);
    expect(retrievedByNodeB.outcome).toBe("FOUND");
    if (retrievedByNodeB.outcome === "FOUND") {
      expect(retrievedByNodeB.payload.rawSuccessorToken).toBe(successorToken);
      expect(retrievedByNodeB.payload.familyId).toBe(familyId);
    }
  });

  it("enforces confidentiality: raw successor token is never in plaintext in transient store", async () => {
    const sharedMap = new Map();
    const store = new InMemoryTransientStore(sharedMap);
    const vault = new EphemeralSuccessorVault(testKey, store);

    const tokenHash = "confidential-token-hash";
    const idempotencyKey = "confidential-idem-key";
    const rawSuccessorSecret = "super-secret-raw-successor-credential-token";
    const familyId = "family-123";

    await vault.storeSuccessor(tokenHash, idempotencyKey, rawSuccessorSecret, familyId, 30);

    // Inspect the actual raw stored string in the transient store
    const entries = Array.from(sharedMap.values());
    expect(entries).toHaveLength(1);
    const storedRawString = entries[0].value;

    // Must NOT contain the plaintext successor credential or family ID in plain text
    expect(storedRawString).not.toContain(rawSuccessorSecret);
    const parsed = JSON.parse(storedRawString);
    expect(parsed.iv).toBeDefined();
    expect(parsed.authTag).toBeDefined();
    expect(parsed.data).toBeDefined(); // Hex ciphertext
  });

  it("returns INVALID on authentication-tag tampering", async () => {
    const sharedMap = new Map();
    const store = new InMemoryTransientStore(sharedMap);
    const vault = new EphemeralSuccessorVault(testKey, store);

    const tokenHash = "tamper-test-hash";
    const idempotencyKey = "tamper-test-key";
    const rawSuccessor = "raw-successor-token";
    const familyId = "family-tamper";

    await vault.storeSuccessor(tokenHash, idempotencyKey, rawSuccessor, familyId, 30);

    // Corrupt the authTag in the transient store (simulating tampering attack)
    for (const [k, v] of sharedMap.entries()) {
      const record = JSON.parse(v.value);
      record.authTag = "00000000000000000000000000000000"; // Corrupted MAC
      sharedMap.set(k, { ...v, value: JSON.stringify(record) });
    }

    // Attempt retrieval: AES-GCM verification must fail and return typed outcome INVALID
    const result = await vault.retrieveSuccessor(tokenHash, idempotencyKey);
    expect(result.outcome).toBe("INVALID");
  });

  it("returns UNAVAILABLE safely when store encounters an outage", async () => {
    const brokenStore = {
      async get() {
        return { outcome: TransientStoreOutcome.UNAVAILABLE, error: "Connection lost" };
      },
      async set() {
        return { outcome: TransientStoreOutcome.UNAVAILABLE, error: "Connection lost" };
      },
      async del() {
        return { outcome: TransientStoreOutcome.UNAVAILABLE, error: "Connection lost" };
      },
    };

    const vault = new EphemeralSuccessorVault(testKey, brokenStore);
    const retrieved = await vault.retrieveSuccessor("any-hash", "any-key");
    expect(retrieved.outcome).toBe("UNAVAILABLE");
  });

  it("proves production configuration cannot silently select in-memory storage", () => {
    expect(() =>
      createSuccessorVaultFromConfig({
        NODE_ENV: "production",
        ENABLE_REFRESH_SESSIONS: true,
        // REDIS_URL missing!
      })
    ).toThrow("Production refresh-session functionality requires REDIS_URL");

    expect(() =>
      createSuccessorVaultFromConfig({
        NODE_ENV: "production",
        ENABLE_REFRESH_SESSIONS: true,
        REDIS_URL: "redis://127.0.0.1:6379",
        // SUCCESSOR_VAULT_ENCRYPTION_KEY missing!
      })
    ).toThrow("SUCCESSOR_VAULT_ENCRYPTION_KEY");
  });
});
