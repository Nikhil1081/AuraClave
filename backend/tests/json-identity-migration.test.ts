import { describe, expect, it } from "vitest";
import {
  isDisposableMigrationDatabaseUrl,
  normalizeIdentityEmail,
  reviewLegacyIdentitySource,
} from "../src/migrations/json-identity-migration.js";

const passwordHash = `$2b$10$${"a".repeat(53)}`;
const createdAt = "2024-02-03T04:05:06.000Z";

function sourceUser(overrides: Record<string, unknown> = {}) {
  return {
    id: "c04f2399-8c8f-4e51-9324-9e07883bc501",
    email: "  Person@Example.com ",
    passwordHash,
    fullName: "Example Person",
    createdAt,
    ...overrides,
  };
}

describe("JSON identity migration source review", () => {
  it("maps identity fields without changing the user ID or bcrypt hash", () => {
    const review = reviewLegacyIdentitySource([sourceUser()]);
    const [mapped] = review.validRecords;

    expect(review.sourceTotal).toBe(1);
    expect(review.malformedRecords).toHaveLength(0);
    expect(mapped).toMatchObject({
      id: "c04f2399-8c8f-4e51-9324-9e07883bc501",
      email: "person@example.com",
      fullName: "Example Person",
      avatarUrl: null,
      status: "active",
      emailVerifiedAt: null,
      lastLoginAt: null,
    });
    expect(mapped.passwordHash === passwordHash).toBe(true);
    expect(mapped.createdAt?.toISOString()).toBe(createdAt);
    expect(mapped.updatedAt?.toISOString()).toBe(createdAt);
  });

  it("reports malformed records and duplicate IDs and normalized emails", () => {
    const review = reviewLegacyIdentitySource([
      sourceUser({ id: "not-a-uuid" }),
      sourceUser({
        id: "c04f2399-8c8f-4e51-9324-9e07883bc502",
        email: "person@example.com",
        passwordHash: "unsupported",
      }),
    ]);

    expect(review.sourceTotal).toBe(2);
    expect(review.malformedRecords).toHaveLength(2);
    expect(review.duplicateNormalizedEmails).toEqual([
      { value: "person@example.com", sourceIndexes: [1, 2] },
    ]);
    expect(review.duplicateUserIds).toHaveLength(0);
    expect(review.malformedRecords[1].sourceId).toBe("c04f2399-8c8f-4e51-9324-9e07883bc502");
    expect(review.malformedRecords[1].issues.some((issue) => issue.path === "passwordHash")).toBe(true);
  });

  it("reports repeated user IDs even when their email strings differ by case", () => {
    const first = sourceUser();
    const second = sourceUser({ email: "other@example.com" });
    const review = reviewLegacyIdentitySource([first, second]);

    expect(review.duplicateUserIds).toEqual([
      { value: "c04f2399-8c8f-4e51-9324-9e07883bc501", sourceIndexes: [1, 2] },
    ]);
  });

  it("canonicalizes UUID casing to the PostgreSQL representation", () => {
    const review = reviewLegacyIdentitySource([
      sourceUser({ id: "C04F2399-8C8F-4E51-9324-9E07883BC501" }),
    ]);

    expect(review.validRecords[0].id).toBe("c04f2399-8c8f-4e51-9324-9e07883bc501");
  });

  it("rejects unsupported fields and timestamps without a timezone", () => {
    const review = reviewLegacyIdentitySource([
      sourceUser({ lastLoginAt: null }),
      sourceUser({ id: "c04f2399-8c8f-4e51-9324-9e07883bc502", createdAt: "2024-02-03T04:05:06" }),
    ]);

    expect(review.malformedRecords).toHaveLength(2);
    expect(review.malformedRecords[0].issues.some((issue) => issue.code === "unrecognized_keys")).toBe(true);
    expect(review.malformedRecords[1].issues.some((issue) => issue.path === "createdAt")).toBe(true);
  });

  it("blocks an empty source instead of treating it as a successful no-op", () => {
    expect(reviewLegacyIdentitySource([]).rootError).toContain("at least one user");
  });

  it("normalizes addresses using the active JSON authentication rule", () => {
    expect(normalizeIdentityEmail("  USER@Example.COM  ")).toBe("user@example.com");
  });
});

describe("disposable migration database guard", () => {
  it("accepts only local test or disposable PostgreSQL databases", () => {
    expect(isDisposableMigrationDatabaseUrl("postgresql://test:test@localhost:5432/auraclave_test")).toBe(true);
    expect(isDisposableMigrationDatabaseUrl("postgresql://test:test@127.0.0.1:5432/disposable_identity")).toBe(true);
    expect(isDisposableMigrationDatabaseUrl("postgresql://test:test@[::1]:5432/auraclave_test")).toBe(true);
    expect(isDisposableMigrationDatabaseUrl("postgresql://user:pass@db.example.com:5432/auraclave_test")).toBe(false);
    expect(isDisposableMigrationDatabaseUrl("postgresql://test:test@localhost:5432/auraclave")).toBe(false);
    expect(isDisposableMigrationDatabaseUrl("not-a-url")).toBe(false);
  });
});
