import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { validateEnvConfig } from "../src/lib/env.js";

let originalJwtSecret: string | undefined;

beforeEach(() => {
  originalJwtSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "unit-test-jwt-secret";
});

afterEach(() => {
  if (originalJwtSecret === undefined) {
    delete process.env.JWT_SECRET;
  } else {
    process.env.JWT_SECRET = originalJwtSecret;
  }
});

describe("environment validation", () => {
  it("fails when JWT_SECRET is missing", () => {
    delete process.env.JWT_SECRET;

    expect(() => validateEnvConfig()).toThrow("JWT_SECRET environment variable is required.");
  });

  it("accepts a configured JWT_SECRET", () => {
    process.env.JWT_SECRET = "configured-test-jwt-secret";

    expect(() => validateEnvConfig()).not.toThrow();
  });
});
