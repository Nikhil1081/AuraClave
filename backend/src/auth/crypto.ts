import crypto from "crypto";

export interface EncryptedData {
  iv: string;      // 12-byte hex for AES-GCM
  authTag: string; // 16-byte hex
  data: string;    // hex ciphertext
}

const WEAK_PLACEHOLDER_KEYS = new Set([
  "0000000000000000000000000000000000000000000000000000000000000000",
  "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
  "1234567890123456789012345678901234567890123456789012345678901234",
  "abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd",
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
  "///////////////////////////////////////////=",
]);

/**
 * Parses an explicit encryption key string in hex (64 chars) or base64 (44 chars).
 * Strictly requires that the decoded key is exactly 32 bytes (256 bits).
 * Rejects malformed encodings, wrong decoded lengths, and weak placeholder keys.
 * Never silently truncates, pads, or hashes the key.
 */
export function parseEncryptionKey(keyString?: string): Buffer {
  if (!keyString || typeof keyString !== "string") {
    throw new Error("Encryption key is required.");
  }

  const trimmed = keyString.trim();

  // Reject weak placeholders
  if (WEAK_PLACEHOLDER_KEYS.has(trimmed.toLowerCase()) || WEAK_PLACEHOLDER_KEYS.has(trimmed)) {
    throw new Error("Encryption key is a known weak placeholder and cannot be used.");
  }

  let decoded: Buffer;

  // Check Hex format: 64 hexadecimal characters
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    decoded = Buffer.from(trimmed, "hex");
  } else if (/^[A-Za-z0-9+/]{43}=$/.test(trimmed) || /^[A-Za-z0-9+/]{42}==$/.test(trimmed) || /^[A-Za-z0-9+/]{44}$/.test(trimmed)) {
    // Check Base64 format: 32 bytes base64-encoded is 44 characters (with padding)
    decoded = Buffer.from(trimmed, "base64");
  } else {
    throw new Error(
      "Invalid encryption key encoding: key must be either a 64-character hex string or a 44-character base64 string representing exactly 32 bytes."
    );
  }

  if (decoded.length !== 32) {
    throw new Error(
      `Invalid encryption key length: decoded key must be exactly 32 bytes for AES-256-GCM, got ${decoded.length} bytes.`
    );
  }

  return decoded;
}

/**
 * Encrypts a plaintext string with AES-256-GCM.
 * Generates a fresh 12-byte cryptographically secure random IV for every encryption.
 * Optionally binds Authenticated Associated Data (AAD) for cryptographic integrity.
 */
export function encryptPayload(
  plaintext: string,
  key: Buffer,
  associatedData?: string
): EncryptedData {
  if (!Buffer.isBuffer(key) || key.length !== 32) {
    throw new Error("Encryption key must be exactly 32 bytes for AES-256-GCM.");
  }

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

  if (associatedData) {
    cipher.setAAD(Buffer.from(associatedData, "utf-8"));
  }

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
 * Validates matching Authenticated Associated Data (AAD) if provided.
 * Throws an error if authentication fails (tampering, wrong key, or mismatched AAD).
 */
export function decryptPayload(
  encrypted: EncryptedData,
  key: Buffer,
  associatedData?: string
): string {
  if (!Buffer.isBuffer(key) || key.length !== 32) {
    throw new Error("Encryption key must be exactly 32 bytes for AES-256-GCM.");
  }

  if (!encrypted || !encrypted.iv || !encrypted.authTag || !encrypted.data) {
    throw new Error("Invalid encrypted payload structure.");
  }

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(encrypted.iv, "hex"));

  if (associatedData) {
    decipher.setAAD(Buffer.from(associatedData, "utf-8"));
  }

  decipher.setAuthTag(Buffer.from(encrypted.authTag, "hex"));
  let decrypted = decipher.update(encrypted.data, "hex", "utf-8");
  decrypted += decipher.final("utf-8");
  return decrypted;
}
