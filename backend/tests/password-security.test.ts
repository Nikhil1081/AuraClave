import { describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import {
  PasswordService,
  identifyHashAlgorithm,
  DEFAULT_ARGON2_CONFIG,
} from "../src/auth/password.js";

describe("M1.4.2 Password Security Engine & Algorithm Identification", () => {
  const passwordService = new PasswordService();

  it("identifies bcrypt hashes ($2a$, $2b$, $2y$)", () => {
    expect(identifyHashAlgorithm("$2b$10$abcdefghijklmnopqrstuvwxyz01234567890123456789012")).toBe("bcrypt");
    expect(identifyHashAlgorithm("$2a$12$abcdefghijklmnopqrstuvwxyz01234567890123456789012")).toBe("bcrypt");
    expect(identifyHashAlgorithm("$2y$10$abcdefghijklmnopqrstuvwxyz01234567890123456789012")).toBe("bcrypt");
  });

  it("identifies Argon2id hashes ($argon2id$)", () => {
    expect(
      identifyHashAlgorithm("$argon2id$v=19$m=19456,t=2,p=1$abcdefg$hijklmnopqrstuvwxyz")
    ).toBe("argon2id");
  });

  it("identifies unknown or malformed strings as unknown", () => {
    expect(identifyHashAlgorithm("plaintext-password")).toBe("unknown");
    expect(identifyHashAlgorithm("md5:1234567890abcdef")).toBe("unknown");
    expect(identifyHashAlgorithm("")).toBe("unknown");
  });

  it("hashes passwords with Argon2id and generates unique salts", async () => {
    const pwd = "SecurePassword123!";
    const hash1 = await passwordService.hashPassword(pwd);
    const hash2 = await passwordService.hashPassword(pwd);

    expect(hash1).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(hash2).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(hash1).not.toBe(hash2); // unique salt
  });

  it("verifies Argon2id hashes accurately", async () => {
    const pwd = "CorrectPassword123!";
    const hash = await passwordService.hashPassword(pwd);

    const validResult = await passwordService.verifyPassword(pwd, hash);
    expect(validResult.valid).toBe(true);
    expect(validResult.algorithm).toBe("argon2id");
    expect(validResult.needsUpgrade).toBe(false);

    const invalidResult = await passwordService.verifyPassword("WrongPassword!", hash);
    expect(invalidResult.valid).toBe(false);
  });
});

describe("M1.4.2 Legacy bcrypt Compatibility & 72-Byte Boundary Matrix", () => {
  const passwordService = new PasswordService();

  // Test matrix for various lengths and multibyte encodings
  const lengthVectors = [
    { label: "10 bytes ASCII", pwd: "a".repeat(10), byteLen: 10, isBeyond72: false },
    { label: "32 bytes ASCII", pwd: "b".repeat(32), byteLen: 32, isBeyond72: false },
    { label: "71 bytes ASCII", pwd: "c".repeat(71), byteLen: 71, isBeyond72: false },
    { label: "72 bytes ASCII (Exact boundary)", pwd: "d".repeat(72), byteLen: 72, isBeyond72: false },
    { label: "73 bytes ASCII (Boundary + 1)", pwd: "e".repeat(73), byteLen: 73, isBeyond72: true },
    { label: "100 bytes ASCII", pwd: "f".repeat(100), byteLen: 100, isBeyond72: true },
    { label: "256 bytes ASCII", pwd: "g".repeat(256), byteLen: 256, isBeyond72: true },
    { label: "2-byte UTF-8 accented (é = 2 bytes, 36 chars = 72 bytes)", pwd: "é".repeat(36), byteLen: 72, isBeyond72: false },
    { label: "2-byte UTF-8 accented (37 chars = 74 bytes)", pwd: "é".repeat(37), byteLen: 74, isBeyond72: true },
    { label: "3-byte CJK ideographs (語 = 3 bytes, 24 chars = 72 bytes)", pwd: "語".repeat(24), byteLen: 72, isBeyond72: false },
    { label: "3-byte CJK ideographs (25 chars = 75 bytes)", pwd: "語".repeat(25), byteLen: 75, isBeyond72: true },
    { label: "4-byte SMP emojis (🔐 = 4 bytes, 18 chars = 72 bytes)", pwd: "🔐".repeat(18), byteLen: 72, isBeyond72: false },
    { label: "4-byte SMP emojis (19 chars = 76 bytes)", pwd: "🔐".repeat(19), byteLen: 76, isBeyond72: true },
  ];

  for (const { label, pwd, byteLen, isBeyond72 } of lengthVectors) {
    it(`verifies existing bcrypt hash for [${label}] (byte length ${byteLen})`, { timeout: 15000 }, async () => {
      const computedByteLen = Buffer.byteLength(pwd, "utf-8");
      expect(computedByteLen).toBe(byteLen);

      // Hash with legacy bcryptjs using cost 4 for fast unit test verification
      const salt = await bcrypt.genSalt(4);
      const bcryptHash = await bcrypt.hash(pwd, salt);

      // Verify through PasswordService
      const res = await passwordService.verifyPassword(pwd, bcryptHash);
      expect(res.valid).toBe(true);
      expect(res.algorithm).toBe("bcrypt");
      expect(res.needsUpgrade).toBe(true);
      expect(res.upgradedHash).toBeDefined();
      expect(res.upgradedHash).toMatch(/^\$argon2id\$/);

      // Test wrong password:
      // If password is <= 72 bytes, appending "!" changes the first 72 bytes, so it MUST fail.
      // If password is > 72 bytes, appending "!" only changes bytes > 72, which bcrypt truncates!
      // To test a truly wrong password for > 72 bytes in bcrypt, we modify the prefix (e.g. replace first char).
      const trulyWrongPassword = "X" + pwd.slice(1);
      const wrongRes = await passwordService.verifyPassword(trulyWrongPassword, bcryptHash);
      expect(wrongRes.valid).toBe(false);
      expect(wrongRes.needsUpgrade).toBe(false);
      expect(wrongRes.upgradedHash).toBeUndefined();

      // If the password exceeds 72 bytes, document that bcryptjs matches passwords differing only beyond 72 bytes:
      if (isBeyond72) {
        const truncatedVariant = pwd + "!different_suffix!";
        const truncatedRes = await passwordService.verifyPassword(truncatedVariant, bcryptHash);
        expect(truncatedRes.valid).toBe(true); // Demonstrates bcrypt 72-byte truncation in practice
      }
    });
  }

  it("verifies bcryptjs 72-byte truncation behavior", async () => {
    // In standard bcrypt/bcryptjs, characters beyond byte 72 are truncated by Blowfish.
    // Document and assert this exact behavior.
    const base72 = "x".repeat(72);
    const passA = base72 + "AAAA";
    const passB = base72 + "BBBB";

    const hash = await bcrypt.hash(passA, 4);
    // bcryptjs compares the first 72 bytes
    const matchSame = await bcrypt.compare(passA, hash);
    const matchDifferentSuffix = await bcrypt.compare(passB, hash);

    expect(matchSame).toBe(true);
    expect(matchDifferentSuffix).toBe(true); // Demonstrates 72-byte truncation in bcryptjs

    // Conversely, Argon2id NEVER truncates at 72 bytes
    const argonHash = await passwordService.hashPassword(passA);
    const argonMatchA = await passwordService.verifyPassword(passA, argonHash);
    const argonMatchB = await passwordService.verifyPassword(passB, argonHash);

    expect(argonMatchA.valid).toBe(true);
    expect(argonMatchB.valid).toBe(false); // Argon2id distinguishes long passwords!
  });
});
