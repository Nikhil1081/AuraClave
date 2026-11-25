import { describe, expect, it } from "vitest";
import { parseDatabaseConfig } from "../src/database/config.js";

describe("parseDatabaseConfig", () => {
  it("rejects a missing or non-PostgreSQL connection URL", () => {
    expect(() => parseDatabaseConfig({})).toThrow(/PostgreSQL connection URL/);
    expect(() => parseDatabaseConfig({ DATABASE_URL: "not-a-url" })).toThrow(
      /PostgreSQL connection URL/,
    );
    expect(() =>
      parseDatabaseConfig({ DATABASE_URL: "https://example.test/database" }),
    ).toThrow(/PostgreSQL connection URL/);
  });

  it("enables certificate-validated TLS by default in production", () => {
    const config = parseDatabaseConfig({
      DATABASE_URL: "postgresql://db.example.test/auraclave",
      NODE_ENV: "production",
    });

    expect(config.ssl).toEqual({ rejectUnauthorized: true });
  });

  it("allows explicit local TLS settings outside production", () => {
    const config = parseDatabaseConfig({
      DATABASE_URL: "postgres://localhost/auraclave",
      DATABASE_SSL: "disable",
      NODE_ENV: "development",
    });

    expect(config.ssl).toBe(false);
  });

  it("does not allow disabling TLS in production", () => {
    expect(() =>
      parseDatabaseConfig({
        DATABASE_URL: "postgresql://db.example.test/auraclave",
        DATABASE_SSL: "disable",
        NODE_ENV: "production",
      }),
    ).toThrow(/not allowed in production/);
  });
});
