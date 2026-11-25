import { encryptPayload, decryptPayload, type EncryptedData } from "./crypto.js";
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
 * Uses AES-256-GCM authenticated encryption.
 * The encrypted ciphertext is stored in a shared distributed transient store (Redis or in-memory for testing).
 * Raw successor tokens are NEVER stored in plaintext in the transient store, memory, database, or logs.
 */
export class EphemeralSuccessorVault {
  private vaultKey: Buffer;
  private store: ITransientStore;

  constructor(vaultKey: Buffer, store: ITransientStore) {
    if (vaultKey.length !== 32) {
      throw new Error("Vault key must be exactly 32 bytes for AES-256-GCM.");
    }
    this.vaultKey = vaultKey;
    this.store = store;
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

    const encrypted = encryptPayload(JSON.stringify(payload), this.vaultKey);
    return await this.store.set(key, JSON.stringify(encrypted), ttlSeconds);
  }

  /**
   * Encrypts payload directly for PostgreSQL persistence in the same rotation transaction.
   */
  public encryptForPersistence(
    rawSuccessorToken: string,
    familyId: string
  ): string {
    const payload: CachedSuccessorPayload = {
      rawSuccessorToken,
      familyId,
      createdAt: Date.now(),
    };
    return JSON.stringify(encryptPayload(JSON.stringify(payload), this.vaultKey));
  }

  /**
   * Decrypts payload from PostgreSQL or Redis.
   */
  public decryptPayload(ciphertextJson: string): CachedSuccessorPayload | null {
    try {
      const encryptedData: EncryptedData = JSON.parse(ciphertextJson);
      const plaintext = decryptPayload(encryptedData, this.vaultKey);
      return JSON.parse(plaintext) as CachedSuccessorPayload;
    } catch {
      return null;
    }
  }

  /**
   * Retrieves and decrypts the cached successor from the transient store with typed outcomes.
   */
  public async retrieveSuccessor(
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
      const plaintext = decryptPayload(encryptedData, this.vaultKey);
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
  // If custom store provided (e.g. in tests)
  if (customStore) {
    const key = config.SUCCESSOR_VAULT_ENCRYPTION_KEY
      ? Buffer.from(config.SUCCESSOR_VAULT_ENCRYPTION_KEY, "utf-8").subarray(0, 32)
      : crypto.randomBytes(32);
    return new EphemeralSuccessorVault(key, customStore);
  }

  const isProduction = config.NODE_ENV === "production";
  const refreshEnabled = config.ENABLE_REFRESH_SESSIONS === true;

  if (isProduction && refreshEnabled) {
    if (!config.REDIS_URL?.trim()) {
      throw new Error("Production refresh-session functionality requires REDIS_URL to be configured.");
    }
    if (!config.SUCCESSOR_VAULT_ENCRYPTION_KEY || config.SUCCESSOR_VAULT_ENCRYPTION_KEY.length < 32) {
      throw new Error("Production refresh-session functionality requires SUCCESSOR_VAULT_ENCRYPTION_KEY (>= 32 chars).");
    }
    const key = Buffer.from(config.SUCCESSOR_VAULT_ENCRYPTION_KEY, "utf-8").subarray(0, 32);
    const redisStore = new RedisTransientStore(config.REDIS_URL);
    return new EphemeralSuccessorVault(key, redisStore);
  }

  // Non-production or test:
  if (config.REDIS_URL?.trim()) {
    const key = config.SUCCESSOR_VAULT_ENCRYPTION_KEY
      ? Buffer.from(config.SUCCESSOR_VAULT_ENCRYPTION_KEY, "utf-8").subarray(0, 32)
      : crypto.randomBytes(32);
    return new EphemeralSuccessorVault(key, new RedisTransientStore(config.REDIS_URL));
  }

  // Development/Test fallback
  const devKey = config.SUCCESSOR_VAULT_ENCRYPTION_KEY
    ? Buffer.from(config.SUCCESSOR_VAULT_ENCRYPTION_KEY, "utf-8").subarray(0, 32)
    : crypto.randomBytes(32);
  return new EphemeralSuccessorVault(devKey, new InMemoryTransientStore());
}

export function getSuccessorVault(): EphemeralSuccessorVault {
  if (!configuredSuccessorVault) {
    // Lazy default fallback for local/tests
    const devKey = crypto.randomBytes(32);
    configuredSuccessorVault = new EphemeralSuccessorVault(devKey, new InMemoryTransientStore());
  }
  return configuredSuccessorVault;
}

export function setSuccessorVault(vault: EphemeralSuccessorVault): void {
  configuredSuccessorVault = vault;
}
