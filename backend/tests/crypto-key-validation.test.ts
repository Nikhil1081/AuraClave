import { describe, expect, it } from "vitest";
import crypto from "crypto";
import {
  encryptPayload,
  decryptPayload,
  parseEncryptionKey,
} from "../src/auth/crypto.js";

describe("M1.4 Crypto & Encryption Key Strict Validation", () => {
  it("accepts valid 64-character hex encryption keys", () => {
    const validHex = crypto.randomBytes(32).toString("hex");
    expect(validHex).toHaveLength(64);

    const parsed = parseEncryptionKey(validHex);
    expect(Buffer.isBuffer(parsed)).toBe(true);
    expect(parsed).toHaveLength(32);
    expect(parsed.toString("hex")).toBe(validHex.toLowerCase());
  });

  it("accepts valid 44-character base64 encryption keys", () => {
    const validBase64 = crypto.randomBytes(32).toString("base64");
    expect(validBase64).toHaveLength(44);

    const parsed = parseEncryptionKey(validBase64);
    expect(Buffer.isBuffer(parsed)).toBe(true);
    expect(parsed).toHaveLength(32);
    expect(parsed.toString("base64")).toBe(validBase64);
  });

  it("rejects missing, undefined, or non-string encryption keys", () => {
    expect(() => parseEncryptionKey(undefined)).toThrow("Encryption key is required.");
    expect(() => parseEncryptionKey("")).toThrow("Encryption key is required.");
  });

  it("rejects weak placeholder keys", () => {
    expect(() =>
      parseEncryptionKey("0000000000000000000000000000000000000000000000000000000000000000")
    ).toThrow("known weak placeholder");

    expect(() =>
      parseEncryptionKey("1234567890123456789012345678901234567890123456789012345678901234")
    ).toThrow("known weak placeholder");

    expect(() =>
      parseEncryptionKey("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=")
    ).toThrow("known weak placeholder");
  });

  it("rejects keys with invalid encodings or wrong lengths", () => {
    // 63 hex chars (too short)
    expect(() => parseEncryptionKey("a".repeat(63))).toThrow("Invalid encryption key encoding");
    // 65 hex chars (too long)
    expect(() => parseEncryptionKey("a".repeat(65))).toThrow("Invalid encryption key encoding");
    // Non-hex characters
    expect(() => parseEncryptionKey("g".repeat(64))).toThrow("Invalid encryption key encoding");
    // Arbitrary UTF-8 passphrase (must be explicit hex or base64)
    expect(() => parseEncryptionKey("my-super-secret-passphrase-that-is-long-enough-32-chars")).toThrow(
      "Invalid encryption key encoding"
    );
  });

  it("encrypts and decrypts with Authenticated Associated Data (AAD)", () => {
    const key = crypto.randomBytes(32);
    const plaintext = JSON.stringify({ token: "xyz", familyId: "fam-1" });
    const aad = "auraclave:binding:hash123:fam-1:idem-key-1";

    const encrypted = encryptPayload(plaintext, key, aad);
    expect(encrypted.iv).toHaveLength(24); // 12 bytes hex
    expect(encrypted.authTag).toHaveLength(32); // 16 bytes hex

    // Successful decryption with exact matching AAD
    const decrypted = decryptPayload(encrypted, key, aad);
    expect(decrypted).toBe(plaintext);
  });

  it("fails decryption if AAD is mismatched or missing", () => {
    const key = crypto.randomBytes(32);
    const plaintext = "sensitive payload";
    const aad = "binding:user1";

    const encrypted = encryptPayload(plaintext, key, aad);

    // Mismatched AAD
    expect(() => decryptPayload(encrypted, key, "binding:user2")).toThrow();
    // Missing AAD
    expect(() => decryptPayload(encrypted, key)).toThrow();
  });

  it("fails decryption if ciphertext or auth tag is corrupted", () => {
    const key = crypto.randomBytes(32);
    const plaintext = "payload";
    const encrypted = encryptPayload(plaintext, key);

    // Corrupted tag
    const corruptedTag = { ...encrypted, authTag: "00".repeat(16) };
    expect(() => decryptPayload(corruptedTag, key)).toThrow();

    // Corrupted ciphertext
    const corruptedData = { ...encrypted, data: encrypted.data.slice(0, -2) + "00" };
    expect(() => decryptPayload(corruptedData, key)).toThrow();
  });
});
