import crypto from "crypto";
import type { ITransientStore } from "./transient-store.js";
import { InMemoryTransientStore } from "./transient-store.js";

export interface CachedSuccessorPayload {
  rawSuccessorToken: string;
  familyId: string;
  createdAt: number;
}

interface EncryptedPayload {
  iv: string;
  authTag: string;
  data: string;
}

/**
 * Ephemeral encrypted successor-response vault for bounded 30-second idempotent retry handling.
 * Multi-instance design:
 * Uses AES-256-GCM authenticated encryption.
 * Encryption key is either injected from environment (SUCCESSOR_VAULT_ENCRYPTION_KEY) or derived.
 * The encrypted ciphertext is stored in a shared distributed transient store (e.g. Redis).
 * Raw successor tokens are NEVER stored in plaintext in the transient store, memory, database, or logs.
 * Expired entries (> 30s) are automatically expired by the transient store TTL.
 */
export class EphemeralSuccessorVault {
  private vaultKey: Buffer;
  private store: ITransientStore;

  constructor(vaultKey?: Buffer, store?: ITransientStore) {
    // 256-bit encryption key for AES-256-GCM
    this.vaultKey = vaultKey || crypto.randomBytes(32);
    this.store = store || new InMemoryTransientStore();
  }

  /**
   * Derives a deterministic storage key using SHA-256 of the presented token digest and idempotency key.
   */
  private deriveStorageKey(tokenHash: string, idempotencyKey: string): string {
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
  ): Promise<void> {
    const key = this.deriveStorageKey(presentedTokenHash, idempotencyKey);
    const payload: CachedSuccessorPayload = {
      rawSuccessorToken,
      familyId,
      createdAt: Date.now(),
    };

    const iv = crypto.randomBytes(12); // Standard 96-bit IV for AES-GCM
    const cipher = crypto.createCipheriv("aes-256-gcm", this.vaultKey, iv);
    let encrypted = cipher.update(JSON.stringify(payload), "utf-8", "hex");
    encrypted += cipher.final("hex");
    const authTag = cipher.getAuthTag().toString("hex");

    const record: EncryptedPayload = {
      iv: iv.toString("hex"),
      authTag,
      data: encrypted,
    };

    await this.store.set(key, JSON.stringify(record), ttlSeconds);
  }

  /**
   * Retrieves and decrypts the cached successor if present, matching, and within the 30s TTL.
   * If decryption fails (e.g. authTag mismatch / tampering) or store is missing, returns null safely.
   */
  public async retrieveSuccessor(
    presentedTokenHash: string,
    idempotencyKey: string
  ): Promise<CachedSuccessorPayload | null> {
    const key = this.deriveStorageKey(presentedTokenHash, idempotencyKey);
    const serialized = await this.store.get(key);
    if (!serialized) return null;

    try {
      const record: EncryptedPayload = JSON.parse(serialized);
      const { iv, authTag, data } = record;
      const decipher = crypto.createDecipheriv(
        "aes-256-gcm",
        this.vaultKey,
        Buffer.from(iv, "hex")
      );
      decipher.setAuthTag(Buffer.from(authTag, "hex"));
      let decrypted = decipher.update(data, "hex", "utf-8");
      decrypted += decipher.final("utf-8");
      return JSON.parse(decrypted) as CachedSuccessorPayload;
    } catch {
      // Tampering or decryption failure: fail closed safely without revealing internals
      return null;
    }
  }

  /**
   * Returns the underlying transient store.
   */
  public getStore(): ITransientStore {
    return this.store;
  }

  /**
   * Returns the vault encryption key.
   */
  public getVaultKey(): Buffer {
    return this.vaultKey;
  }
}

let defaultSuccessorVault: EphemeralSuccessorVault | null = null;

export function getSuccessorVault(): EphemeralSuccessorVault {
  if (!defaultSuccessorVault) {
    defaultSuccessorVault = new EphemeralSuccessorVault();
  }
  return defaultSuccessorVault;
}

export function setSuccessorVault(vault: EphemeralSuccessorVault): void {
  defaultSuccessorVault = vault;
}
