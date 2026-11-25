import { describe, expect, it } from "vitest";
import crypto from "crypto";
import { generateOpaqueRefreshToken, hashRefreshToken } from "../src/auth/refresh-token.js";
import { EphemeralSuccessorVault } from "../src/auth/successor-vault.js";
import { InMemoryTransientStore } from "../src/auth/transient-store.js";

describe("M1.4.4 Refresh Token Generation & Distributed Successor Vault", () => {
  it("generates opaque refresh tokens with 256 bits of entropy and SHA-256 digests", () => {
    const { rawToken, tokenHash } = generateOpaqueRefreshToken();
    expect(typeof rawToken).toBe("string");
    expect(rawToken.length).toBeGreaterThan(40); // base64url 32 bytes = 43 chars
    expect(tokenHash).toHaveLength(64); // SHA-256 hex string = 64 hex chars
    expect(hashRefreshToken(rawToken)).toBe(tokenHash);
  });

  it("safely stores and retrieves successor responses within TTL", async () => {
    const vault = new EphemeralSuccessorVault();
    const tokenHash = "dummy-token-hash-12345";
    const idempotencyKey = "client-uuid-idem-key-1";
    const successorToken = "raw-successor-token-67890";
    const familyId = "family-uuid-1111";

    await vault.storeSuccessor(tokenHash, idempotencyKey, successorToken, familyId, 2); // 2 second TTL

    const cached = await vault.retrieveSuccessor(tokenHash, idempotencyKey);
    expect(cached).not.toBeNull();
    expect(cached?.rawSuccessorToken).toBe(successorToken);
    expect(cached?.familyId).toBe(familyId);
  });

  it("does not retrieve successor if idempotency key is different", async () => {
    const vault = new EphemeralSuccessorVault();
    const tokenHash = "dummy-token-hash-12345";
    const idempotencyKey = "client-uuid-idem-key-1";
    const successorToken = "raw-successor-token-67890";
    const familyId = "family-uuid-1111";

    await vault.storeSuccessor(tokenHash, idempotencyKey, successorToken, familyId, 30);

    const wrongKeyResult = await vault.retrieveSuccessor(tokenHash, "different-idempotency-key");
    expect(wrongKeyResult).toBeNull();
  });

  it("expires cached successor responses past TTL", async () => {
    const vault = new EphemeralSuccessorVault();
    const tokenHash = "dummy-token-hash-12345";
    const idempotencyKey = "client-uuid-idem-key-1";
    const successorToken = "raw-successor-token-67890";
    const familyId = "family-uuid-1111";

    await vault.storeSuccessor(tokenHash, idempotencyKey, successorToken, familyId, 0.05); // 50ms TTL

    await new Promise((r) => setTimeout(r, 60));

    const expiredResult = await vault.retrieveSuccessor(tokenHash, idempotencyKey);
    expect(expiredResult).toBeNull();
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
    expect(retrievedByNodeB).not.toBeNull();
    expect(retrievedByNodeB?.rawSuccessorToken).toBe(successorToken);
    expect(retrievedByNodeB?.familyId).toBe(familyId);
  });

  it("enforces confidentiality: raw successor token is never in plaintext in transient store", async () => {
    const sharedMap = new Map();
    const store = new InMemoryTransientStore(sharedMap);
    const vault = new EphemeralSuccessorVault(undefined, store);

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

  it("fails closed on authentication-tag tampering", async () => {
    const sharedMap = new Map();
    const store = new InMemoryTransientStore(sharedMap);
    const vault = new EphemeralSuccessorVault(undefined, store);

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

    // Attempt retrieval: AES-GCM verification must fail closed and return null
    const result = await vault.retrieveSuccessor(tokenHash, idempotencyKey);
    expect(result).toBeNull();
  });

  it("fails closed safely when cache is lost or unavailable", async () => {
    // Failing store adapter simulating Redis connection drop / outage
    const brokenStore = {
      async get(): Promise<any> {
        return { outcome: "UNAVAILABLE", error: "Redis connection dropped" };
      },
      async set(): Promise<any> {
        throw new Error("Redis connection dropped");
      },
      async del(): Promise<any> {},
    };

    const vault = new EphemeralSuccessorVault(undefined, brokenStore as any);
    const retrieved = await vault.retrieveSuccessor("any-hash", "any-key");
    expect(retrieved).toBeNull(); // Fails closed without throwing or crashing API
  });
});

  it("proves production configuration fails closed when required infrastructure is absent", () => {
    const { createSuccessorVaultFromConfig } = require("../src/auth/successor-vault.js");
    expect(() =>
      createSuccessorVaultFromConfig({
        NODE_ENV: "production",
        ENABLE_REFRESH_SESSIONS: true,
      })
    ).toThrow(/Production refresh-session functionality requires REDIS_URL/);

    expect(() =>
      createSuccessorVaultFromConfig({
        NODE_ENV: "production",
        ENABLE_REFRESH_SESSIONS: true,
        REDIS_URL: "redis://127.0.0.1:6379",
        SUCCESSOR_VAULT_ENCRYPTION_KEY: "short",
      })
    ).toThrow(/Invalid encryption key encoding/);
  });
import { describe, expect, it } from "vitest";
import {
  encryptPayload,
  decryptPayload,
  parseEncryptionKey,
} from "../src/auth/crypto.js";

describe("M1.4 Cryptographic Key Parsing and AES-256-GCM Integrity", () => {
  it("parses valid 64-character hex keys into exactly 32 bytes", () => {
    const hexKey = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    const parsed = parseEncryptionKey(hexKey);
    expect(Buffer.isBuffer(parsed)).toBe(true);
    expect(parsed.length).toBe(32);
    expect(parsed.toString("hex")).toBe(hexKey);
  });

  it("parses valid 44-character base64 keys into exactly 32 bytes", () => {
    const base64Key = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=";
    const parsed = parseEncryptionKey(base64Key);
    expect(Buffer.isBuffer(parsed)).toBe(true);
    expect(parsed.length).toBe(32);
  });

  it("strictly rejects truncated or undersized keys without padding or truncating", () => {
    const shortHex = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcd";
    expect(() => parseEncryptionKey(shortHex)).toThrow(/Invalid encryption key encoding/);
    expect(() => parseEncryptionKey("short-secret-key")).toThrow(/Invalid encryption key encoding/);
  });

  it("strictly rejects oversized keys without truncation", () => {
    const longHex = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef00";
    expect(() => parseEncryptionKey(longHex)).toThrow(/Invalid encryption key encoding/);
  });

  it("strictly rejects weak placeholder keys", () => {
    const weakZeroes = "0000000000000000000000000000000000000000000000000000000000000000";
    expect(() => parseEncryptionKey(weakZeroes)).toThrow(/weak placeholder/);

    const weakSequence = "1234567890123456789012345678901234567890123456789012345678901234";
    expect(() => parseEncryptionKey(weakSequence)).toThrow(/weak placeholder/);

    const weakBase64 = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
    expect(() => parseEncryptionKey(weakBase64)).toThrow(/weak placeholder/);
  });

  it("encrypts and decrypts with Authenticated Associated Data (AAD)", () => {
    const key = parseEncryptionKey("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");
    const plaintext = JSON.stringify({ token: "successor-secret", familyId: "fam-1" });
    const aad = "aad:tokenHash123:fam-1:idemKey456";

    const encrypted = encryptPayload(plaintext, key, aad);
    expect(encrypted.iv).toHaveLength(24);
    expect(encrypted.authTag).toHaveLength(32);

    // Decrypt with matching AAD succeeds
    const decrypted = decryptPayload(encrypted, key, aad);
    expect(decrypted).toBe(plaintext);

    // Decrypt with mismatched AAD fails (cryptographic integrity rejection)
    expect(() => decryptPayload(encrypted, key, "aad:mismatched:fam-1:idemKey")).toThrow();

    // Decrypt with no AAD fails
    expect(() => decryptPayload(encrypted, key)).toThrow();
  });
});
