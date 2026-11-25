import crypto from "crypto";

export interface EncryptedData {
  iv: string;      // 12-byte hex for AES-GCM
  authTag: string; // 16-byte hex
  data: string;    // hex ciphertext
}

/**
 * Encrypts a plaintext string with AES-256-GCM.
 * Generates a fresh 12-byte cryptographically secure random IV for every encryption.
 */
export function encryptPayload(plaintext: string, key: Buffer): EncryptedData {
  if (key.length !== 32) {
    throw new Error("Encryption key must be exactly 32 bytes for AES-256-GCM.");
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  let encrypted = cipher.update(plaintext, "utf-8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag().toString("hex");

  return {
    iv: iv.toString("hex"),
    authTag,
    data: encrypted,
  };
}

/**
 * Decrypts an AES-256-GCM encrypted payload and verifies the authentication tag.
 * Throws an error if authentication fails (tampering/wrong key).
 */
export function decryptPayload(encrypted: EncryptedData, key: Buffer): string {
  if (key.length !== 32) {
    throw new Error("Encryption key must be exactly 32 bytes for AES-256-GCM.");
  }
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(encrypted.iv, "hex"));
  decipher.setAuthTag(Buffer.from(encrypted.authTag, "hex"));
  let decrypted = decipher.update(encrypted.data, "hex", "utf-8");
  decrypted += decipher.final("utf-8");
  return decrypted;
}

/**
 * Safely parses encryption key string (hex or UTF-8) or returns fallback key.
 */
export function parseEncryptionKey(keyString?: string): Buffer {
  if (!keyString) {
    return crypto.randomBytes(32);
  }
  if (keyString.length === 64 && /^[0-9a-fA-F]+$/.test(keyString)) {
    return Buffer.from(keyString, "hex");
  }
  if (Buffer.byteLength(keyString, "utf-8") >= 32) {
    return Buffer.from(keyString, "utf-8").subarray(0, 32);
  }
  throw new Error("Encryption key must be at least 32 bytes (or 64 hex characters).");
}
