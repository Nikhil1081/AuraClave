import { describe, expect, it } from "vitest";
import jwt from "jsonwebtoken";
import { parseAuthConfig } from "../src/auth/config.js";
import { KeyManager } from "../src/auth/key-manager.js";
import { JwtEngine } from "../src/auth/jwt-engine.js";
import { AuthError, AuthErrorCode } from "../src/auth/errors.js";

describe("M1.4.3 JWT Security Engine & Dual Verification Architecture", () => {
  const devKey = KeyManager.generateDevelopmentKeyPair("key-test-1");
  const keyManager = new KeyManager();
  keyManager.registerKey(devKey, true);

  const config = parseAuthConfig({
    JWT_SECRET: "test-secret-at-least-32-chars-long-for-testing",
    ENABLE_LEGACY_JWT_COMPATIBILITY: "true",
    ENABLE_MODERN_JWT: "true",
    JWT_PUBLIC_KEY: devKey.publicKey,
    JWT_ISSUER: "auraclave-api",
    JWT_AUDIENCE: "auraclave-app",
    ACCESS_TOKEN_TTL_SECONDS: "900",
  });

  const jwtEngine = new JwtEngine(config, keyManager);

  it("issues and verifies legacy HS256 tokens successfully", () => {
    const legacyToken = jwtEngine.generateLegacyToken({
      id: "user-uuid-1234",
      email: "user@example.com",
      fullName: "Legacy User",
    });

    const verified = jwtEngine.verifyToken(legacyToken);
    expect(verified.profile).toBe("legacy");
    if (verified.profile === "legacy") {
      expect(verified.payload.id).toBe("user-uuid-1234");
      expect(verified.payload.email).toBe("user@example.com");
    }
  });

  it("issues and verifies modern RS256 access tokens successfully", () => {
    const modernToken = jwtEngine.generateModernAccessToken({
      userId: "user-uuid-5678",
      sessionId: "session-uuid-9999",
    });

    const verified = jwtEngine.verifyToken(modernToken);
    expect(verified.profile).toBe("modern");
    if (verified.profile === "modern") {
      expect(verified.payload.sub).toBe("user-uuid-5678");
      expect(verified.payload.sid).toBe("session-uuid-9999");
      expect(verified.payload.iss).toBe("auraclave-api");
      expect(verified.payload.aud).toBe("auraclave-app");
      expect(verified.payload.token_use).toBe("access");
    }
  });

  it("strictly isolates cryptographic verification (prevents algorithm confusion)", () => {
    // Attempt algorithm confusion attack: Sign with HMAC using the public key as HMAC secret!
    const forgedToken = jwt.sign(
      { sub: "attacker", sid: "fake-session", token_use: "access", iss: "auraclave-api", aud: "auraclave-app" },
      devKey.publicKey,
      { algorithm: "HS256" }
    );

    // Because forgedToken has alg: HS256, it goes to legacy verifier which uses JWT_SECRET (not devKey.publicKey!)
    // Therefore signature verification will fail closed.
    expect(() => jwtEngine.verifyToken(forgedToken)).toThrow(AuthError);
  });

  it("rejects token with alg 'none'", () => {
    const unsignedToken = jwt.sign(
      { id: "user-uuid-1234", email: "user@example.com" },
      "",
      { algorithm: "none" }
    );
    try {
      jwtEngine.verifyToken(unsignedToken);
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err).toBeInstanceOf(AuthError);
      expect(err.code).toBe(AuthErrorCode.INVALID_TOKEN);
      expect(err.internalDetail).toContain("Unsupported JWT algorithm: none");
    }
  });

  it("rejects modern token if key is revoked", () => {
    const revokedKey = KeyManager.generateDevelopmentKeyPair("revoked-key-1");
    keyManager.registerKey(revokedKey);

    // Sign with revoked key
    const now = Math.floor(Date.now() / 1000);
    const token = jwt.sign(
      {
        sub: "user-1",
        sid: "session-1",
        token_use: "access",
        iss: "auraclave-api",
        aud: "auraclave-app",
        iat: now,
        exp: now + 900,
      },
      revokedKey.privateKey!,
      {
        algorithm: "RS256",
        keyid: revokedKey.kid,
        header: { alg: "RS256", typ: "at+jwt", kid: revokedKey.kid },
      }
    );

    // Revoke key
    keyManager.revokeKey(revokedKey.kid);

    try {
      jwtEngine.verifyToken(token);
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err).toBeInstanceOf(AuthError);
      expect(err.code).toBe(AuthErrorCode.INVALID_TOKEN);
      expect(err.internalDetail).toContain("not found or revoked");
    }
  });

  it("rejects modern token with incorrect issuer or audience", () => {
    const now = Math.floor(Date.now() / 1000);
    const tokenWrongAud = jwt.sign(
      {
        sub: "user-1",
        sid: "session-1",
        token_use: "access",
        iss: "auraclave-api",
        aud: "malicious-audience",
        iat: now,
        exp: now + 900,
      },
      devKey.privateKey!,
      {
        algorithm: "RS256",
        keyid: devKey.kid,
        header: { alg: "RS256", typ: "at+jwt", kid: devKey.kid },
      }
    );
    try {
      jwtEngine.verifyToken(tokenWrongAud);
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err).toBeInstanceOf(AuthError);
      expect(err.code).toBe(AuthErrorCode.INVALID_TOKEN);
      expect(err.internalDetail).toContain("jwt audience invalid");
    }
  });

  it("rejects modern token with wrong token_use", () => {
    const now = Math.floor(Date.now() / 1000);
    const tokenWrongUse = jwt.sign(
      {
        sub: "user-1",
        sid: "session-1",
        token_use: "refresh", // Invalid! Must be "access"
        iss: "auraclave-api",
        aud: "auraclave-app",
        iat: now,
        exp: now + 900,
      },
      devKey.privateKey!,
      {
        algorithm: "RS256",
        keyid: devKey.kid,
        header: { alg: "RS256", typ: "at+jwt", kid: devKey.kid },
      }
    );
    try {
      jwtEngine.verifyToken(tokenWrongUse);
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err).toBeInstanceOf(AuthError);
      expect(err.code).toBe(AuthErrorCode.INVALID_TOKEN);
      expect(err.internalDetail).toContain("Invalid token_use claim");
    }
  });

  it("rejects legacy token past REJECT_LEGACY_JWT_AFTER cutoff", () => {
    const cutoffConfig = parseAuthConfig({
      JWT_SECRET: "test-secret-at-least-32-chars-long-for-testing",
      ENABLE_LEGACY_JWT_COMPATIBILITY: "true",
      REJECT_LEGACY_JWT_AFTER: "2020-01-01T00:00:00Z", // In the past!
    });
    const cutoffEngine = new JwtEngine(cutoffConfig, keyManager);

    const legacyToken = jwtEngine.generateLegacyToken({
      id: "user-1",
      email: "user@example.com",
    });

    try {
      cutoffEngine.verifyToken(legacyToken);
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err).toBeInstanceOf(AuthError);
      expect(err.code).toBe(AuthErrorCode.EXPIRED_TOKEN);
      expect(err.internalDetail).toContain("rejected past cutoff date");
    }
  });
});
