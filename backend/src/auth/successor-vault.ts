import { encryptPayload, decryptPayload, parseEncryptionKey, type EncryptedData } from "./crypto.js";
import {
  type ITransientStore,
  InMemoryTransientStore,
  RedisTransientStore,
  TransientStoreOutcome,
  type TransientStoreResult,
} from "./transient-store.js";
import crypto from "crypto";

export interface CachedSuccessorPayload {
  rawSuccessorToken: string;
  familyId: string;
  createdAt: number;
}

export type VaultRetrievalOutcome =
  | { outcome: "FOUND"; payload: CachedSuccessorPayload }
  | { outcome: "NOT_FOUND" }
  | { outcome: "EXPIRED" }
  | { outcome: "UNAVAILABLE"; error?: string }
  | { outcome: "INVALID"; error?: string };

/**
 * Ephemeral encrypted successor-response vault for bounded 30-second idempotent retry handling.
 * Multi-instance design:
 * Uses AES-256-GCM authenticated encryption with optional Authenticated Associated Data (AAD).
 * The encrypted ciphertext is stored in a shared distributed transient store (Redis or in-memory for testing).
 * Raw successor tokens are NEVER stored in plaintext in the transient store, memory, database, or logs.
 */
export class EphemeralSuccessorVault {
  private vaultKey: Buffer;
  private store: ITransientStore;

  constructor(vaultKey?: Buffer, store?: ITransientStore) {
    const key = vaultKey || crypto.randomBytes(32);
    if (key.length !== 32) {
      throw new Error("Vault key must be exactly 32 bytes for AES-256-GCM.");
    }
    this.vaultKey = key;
    this.store = store || new InMemoryTransientStore();
  }

  /**
   * Derives a deterministic storage key using SHA-256 of the presented token digest and idempotency key.
   */
  public deriveStorageKey(tokenHash: string, idempotencyKey: string): string {
    return `auraclave:retry:${crypto
      .createHash("sha256")
      .update(`${tokenHash}:${idempotencyKey}`)
      .digest("hex")}`;
  }

  /**
   * Derives cryptographic Authenticated Associated Data (AAD) binding tokenHash, familyId, and idempotencyKey.
   */
  public deriveAAD(tokenHash: string, familyId: string, idempotencyKey: string): string {
    return `aad:${tokenHash}:${familyId}:${idempotencyKey}`;
  }

  public constructAAD(tokenHash: string, familyId: string, idempotencyKey: string): string {
    return this.deriveAAD(tokenHash, familyId, idempotencyKey);
  }

  /**
   * Encrypts and stores the successor response in the shared transient store with a 30-second TTL.
   */
  public async storeSuccessor(
    presentedTokenHash: string,
    idempotencyKey: string,
    rawSuccessorToken: string,
    familyId: string,
    ttlSeconds = 30
  ): Promise<TransientStoreResult<void>> {
    const key = this.deriveStorageKey(presentedTokenHash, idempotencyKey);
    const payload: CachedSuccessorPayload = {
      rawSuccessorToken,
      familyId,
      createdAt: Date.now(),
    };

    const aad = `aad:${presentedTokenHash}:${idempotencyKey}`;
    const encrypted = encryptPayload(JSON.stringify(payload), this.vaultKey, aad);
    return await this.store.set(key, JSON.stringify(encrypted), ttlSeconds);
  }

  /**
   * Encrypts payload directly for PostgreSQL persistence in the same rotation transaction.
   * Cryptographically binds the predecessor tokenHash, familyId, and idempotencyKey as AAD.
   */
  public encryptForPersistence(
    rawSuccessorToken: string,
    familyId: string,
    presentedTokenHash: string,
    idempotencyKey: string
  ): string {
    const payload: CachedSuccessorPayload = {
      rawSuccessorToken,
      familyId,
      createdAt: Date.now(),
    };
    const aad = this.deriveAAD(presentedTokenHash, familyId, idempotencyKey);
    return JSON.stringify(encryptPayload(JSON.stringify(payload), this.vaultKey, aad));
  }

  /**
   * Decrypts payload from PostgreSQL or Redis using AAD verification.
   */
  public decryptPayload(
    ciphertextJson: string,
    presentedTokenHash?: string,
    familyId?: string,
    idempotencyKey?: string
  ): CachedSuccessorPayload | null {
    try {
      const encryptedData: EncryptedData = JSON.parse(ciphertextJson);
      const aad =
        presentedTokenHash && familyId && idempotencyKey
          ? this.deriveAAD(presentedTokenHash, familyId, idempotencyKey)
          : undefined;
      const plaintext = decryptPayload(encryptedData, this.vaultKey, aad);
      const payload = JSON.parse(plaintext) as CachedSuccessorPayload;
      if (familyId && payload.familyId !== familyId) {
        return null;
      }
      return payload;
    } catch {
      return null;
    }
  }

  /**
   * Deletes a corrupted or quarantined key from the transient store.
   */
  public async deleteSuccessor(presentedTokenHash: string, idempotencyKey: string): Promise<void> {
    const key = this.deriveStorageKey(presentedTokenHash, idempotencyKey);
    await this.store.del(key);
  }

  /**
   * Retrieves and decrypts the cached successor from the transient store.
   * Returns CachedSuccessorPayload on success, or null on miss/tamper/expired/unavailable.
   */
  public async retrieveSuccessor(
    presentedTokenHash: string,
    idempotencyKey: string
  ): Promise<CachedSuccessorPayload | null> {
    const res = await this.retrieveSuccessorWithOutcome(presentedTokenHash, idempotencyKey);
    return res.outcome === "FOUND" ? res.payload : null;
  }

  /**
   * Retrieves and decrypts the cached successor from the transient store with typed outcomes.
   */
  public async retrieveSuccessorWithOutcome(
    presentedTokenHash: string,
    idempotencyKey: string
  ): Promise<VaultRetrievalOutcome> {
    const key = this.deriveStorageKey(presentedTokenHash, idempotencyKey);
    const storeRes = await this.store.get(key);

    if (storeRes.outcome === TransientStoreOutcome.NOT_FOUND) {
      return { outcome: "NOT_FOUND" };
    }
    if (storeRes.outcome === TransientStoreOutcome.EXPIRED) {
      return { outcome: "EXPIRED" };
    }
    if (storeRes.outcome === TransientStoreOutcome.UNAVAILABLE) {
      return { outcome: "UNAVAILABLE", error: storeRes.error };
    }

    if (!storeRes.value) {
      return { outcome: "NOT_FOUND" };
    }

    try {
      const encryptedData: EncryptedData = JSON.parse(storeRes.value);
      // Decrypt payload. Since storeSuccessor binds AAD containing familyId, but familyId is also inside the payload,
      // in storeSuccessor we can either:
      // A) Bind AAD = `aad:${presentedTokenHash}:${idempotencyKey}`
      // B) Or deriveAAD with tokenHash and idempotencyKey.
      const aad = `aad:${presentedTokenHash}:${idempotencyKey}`;
      let plaintext: string;
      try {
        plaintext = decryptPayload(encryptedData, this.vaultKey, aad);
      } catch {
        // Fallback to decrypting without AAD if saved without AAD
        plaintext = decryptPayload(encryptedData, this.vaultKey);
      }

      const payload = JSON.parse(plaintext) as CachedSuccessorPayload;
      return { outcome: "FOUND", payload };
    } catch (err: unknown) {
      return { outcome: "INVALID", error: err instanceof Error ? err.message : String(err) };
    }
  }

  public getStore(): ITransientStore {
    return this.store;
  }

  public getVaultKey(): Buffer {
    return this.vaultKey;
  }
}

let configuredSuccessorVault: EphemeralSuccessorVault | null = null;

/**
 * Creates and initializes a successor vault strictly from configuration.
 * Fails closed in production if required infrastructure is missing.
 */
export function createSuccessorVaultFromConfig(
  config: {
    NODE_ENV?: string;
    ENABLE_REFRESH_SESSIONS?: boolean;
    REDIS_URL?: string;
    SUCCESSOR_VAULT_ENCRYPTION_KEY?: string;
  },
  customStore?: ITransientStore
): EphemeralSuccessorVault {
  const isProduction = config.NODE_ENV === "production";
  const refreshEnabled = config.ENABLE_REFRESH_SESSIONS === true;

  if (isProduction && refreshEnabled) {
    if (!config.REDIS_URL?.trim()) {
      throw new Error("Production refresh-session functionality requires REDIS_URL to be configured.");
    }
    if (!config.SUCCESSOR_VAULT_ENCRYPTION_KEY?.trim()) {
      throw new Error("Production refresh-session functionality requires SUCCESSOR_VAULT_ENCRYPTION_KEY to be configured.");
    }
    const key = parseEncryptionKey(config.SUCCESSOR_VAULT_ENCRYPTION_KEY);
    const redisStore = customStore || new RedisTransientStore(config.REDIS_URL);
    return new EphemeralSuccessorVault(key, redisStore);
  }

  // Non-production or test with explicit key
  let key: Buffer;
  if (config.SUCCESSOR_VAULT_ENCRYPTION_KEY?.trim()) {
    key = parseEncryptionKey(config.SUCCESSOR_VAULT_ENCRYPTION_KEY);
  } else {
    key = crypto.randomBytes(32);
  }

  if (customStore) {
    return new EphemeralSuccessorVault(key, customStore);
  }

  if (config.REDIS_URL?.trim()) {
    return new EphemeralSuccessorVault(key, new RedisTransientStore(config.REDIS_URL));
  }

  // Explicit non-production/test in-memory fallback
  return new EphemeralSuccessorVault(key, new InMemoryTransientStore());
}

export function getSuccessorVault(): EphemeralSuccessorVault {
  if (!configuredSuccessorVault) {
    const isProduction = process.env.NODE_ENV === "production";
    const refreshEnabled = process.env.ENABLE_REFRESH_SESSIONS === "true" || process.env.ENABLE_REFRESH_SESSIONS === "1";

    if (isProduction && refreshEnabled) {
      throw new Error(
        "Production refresh-session vault cannot be instantiated without explicit configuration (REDIS_URL and SUCCESSOR_VAULT_ENCRYPTION_KEY required)."
      );
    }

    // Lazy default fallback for local/tests
    const devKey = crypto.randomBytes(32);
    configuredSuccessorVault = new EphemeralSuccessorVault(devKey, new InMemoryTransientStore());
  }
  return configuredSuccessorVault;
}

export function setSuccessorVault(vault: EphemeralSuccessorVault): void {
  configuredSuccessorVault = vault;
}
