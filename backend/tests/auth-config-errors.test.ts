import { describe, expect, it } from "vitest";
import { parseAuthConfig } from "../src/auth/config.js";
import { AuthError, AuthErrorCode, normalizeAuthError } from "../src/auth/errors.js";

describe("M1.4.1 Authentication Configuration", () => {
  it("defaults to AUTH_AUTHORITY=json and legacy compatibility enabled", () => {
    const config = parseAuthConfig({
      JWT_SECRET: "test-secret-at-least-32-chars-long-for-testing",
    });
    expect(config.AUTH_AUTHORITY).toBe("json");
    expect(config.ENABLE_LEGACY_JWT_COMPATIBILITY).toBe(true);
    expect(config.ENABLE_MODERN_JWT).toBe(false);
    expect(config.ENABLE_REFRESH_SESSIONS).toBe(false);
    expect(config.ACCESS_TOKEN_TTL_SECONDS).toBe(900);
    expect(config.REFRESH_TOKEN_TTL_SECONDS).toBe(2592000);
  });

  it("throws error if JWT_SECRET is missing while legacy compatibility is true", () => {
    expect(() =>
      parseAuthConfig({
        JWT_SECRET: "",
        ENABLE_LEGACY_JWT_COMPATIBILITY: "true",
      })
    ).toThrow("JWT_SECRET environment variable is required");
  });

  it("enforces minimum 32 chars for JWT_SECRET in production", () => {
    expect(() =>
      parseAuthConfig({
        NODE_ENV: "production",
        JWT_SECRET: "short-secret",
      })
    ).toThrow("must be at least 32 characters long");
  });

  it("allows modern JWT only when public key is provided", () => {
    expect(() =>
      parseAuthConfig({
        JWT_SECRET: "test-secret-at-least-32-chars-long-for-testing",
        ENABLE_MODERN_JWT: "true",
      })
    ).toThrow("JWT_PUBLIC_KEY is required");

    const valid = parseAuthConfig({
      JWT_SECRET: "test-secret-at-least-32-chars-long-for-testing",
      ENABLE_MODERN_JWT: "true",
      JWT_PUBLIC_KEY: "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A...\n-----END PUBLIC KEY-----",
    });
    expect(valid.ENABLE_MODERN_JWT).toBe(true);
  });

  it("validates REJECT_LEGACY_JWT_AFTER as a valid ISO string", () => {
    expect(() =>
      parseAuthConfig({
        JWT_SECRET: "test-secret-at-least-32-chars-long-for-testing",
        REJECT_LEGACY_JWT_AFTER: "invalid-date",
      })
    ).toThrow("must be a valid ISO-8601 date string");

    const valid = parseAuthConfig({
      JWT_SECRET: "test-secret-at-least-32-chars-long-for-testing",
      REJECT_LEGACY_JWT_AFTER: "2027-01-01T00:00:00Z",
    });
    expect(valid.REJECT_LEGACY_JWT_AFTER).toBe("2027-01-01T00:00:00Z");
  });

  it("enforces REDIS_URL and encryption key in production when refresh sessions are enabled", () => {
    expect(() =>
      parseAuthConfig({
        NODE_ENV: "production",
        JWT_SECRET: "test-secret-at-least-32-chars-long-for-testing",
        ENABLE_REFRESH_SESSIONS: "true",
      })
    ).toThrow("REDIS_URL is required in production");

    expect(() =>
      parseAuthConfig({
        NODE_ENV: "production",
        JWT_SECRET: "test-secret-at-least-32-chars-long-for-testing",
        ENABLE_REFRESH_SESSIONS: "true",
        REDIS_URL: "redis://127.0.0.1:6379",
        SUCCESSOR_VAULT_ENCRYPTION_KEY: "short",
      })
    ).toThrow("SUCCESSOR_VAULT_ENCRYPTION_KEY must be at least 32 characters");

    const validProd = parseAuthConfig({
      NODE_ENV: "production",
      JWT_SECRET: "test-secret-at-least-32-chars-long-for-testing",
      ENABLE_REFRESH_SESSIONS: "true",
      REDIS_URL: "redis://prod-redis.internal:6379",
      SUCCESSOR_VAULT_ENCRYPTION_KEY: "01234567890123456789012345678901",
    });
    expect(validProd.REDIS_URL).toBe("redis://prod-redis.internal:6379");
  });
});

describe("M1.4.1 Authentication Error Taxonomy", () => {
  it("serializes to safe response without leaking internal diagnostics", () => {
    const err = new AuthError(
      AuthErrorCode.INVALID_CREDENTIALS,
      "Internal query failed on user lookup"
    );

    expect(err.code).toBe(AuthErrorCode.INVALID_CREDENTIALS);
    expect(err.httpStatus).toBe(400);
    expect(err.safeMessage).toBe("Invalid email or password.");
    expect(err.internalDetail).toBe("Internal query failed on user lookup");

    const res = err.toResponse();
    expect(res).toEqual({
      error: "Invalid email or password.",
      code: "INVALID_CREDENTIALS",
    });
    expect(JSON.stringify(res)).not.toContain("Internal query");
  });

  it("maps ACCOUNT_NOT_FOUND to generic credential error to prevent enumeration", () => {
    const err = new AuthError(AuthErrorCode.ACCOUNT_NOT_FOUND, "User ID 123 not in database");
    expect(err.httpStatus).toBe(400);
    expect(err.safeMessage).toBe("Invalid email or password.");
    expect(err.toResponse().error).toBe("Invalid email or password.");
  });

  it("maps database unavailable to HTTP 503", () => {
    const err = new AuthError(AuthErrorCode.AUTH_DATABASE_UNAVAILABLE);
    expect(err.httpStatus).toBe(503);
    expect(err.safeMessage).toContain("temporarily unavailable");
  });

  it("normalizes unknown errors safely", () => {
    const err = normalizeAuthError(new Error("Postgres connection timeout"));
    expect(err.code).toBe(AuthErrorCode.INTERNAL_AUTH_FAILURE);
    expect(err.httpStatus).toBe(500);
    expect(err.safeMessage).toBe("An internal authentication error occurred.");
    expect(err.internalDetail).toBe("Postgres connection timeout");
  });
});
