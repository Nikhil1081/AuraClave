import { afterAll, beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { upgradeUserPasswordHash, findUserById, createUser, resetDbCache } from "../src/db.js";

describe("M1.4.2 Compare-and-Swap Password Hash Upgrade", () => {
  let tempUsersJson: string;

  beforeAll(async () => {
    tempUsersJson = path.join(os.tmpdir(), `test-users-cas-${Date.now()}.json`);
    await fs.writeFile(tempUsersJson, "[]", "utf-8");
    process.env.USERS_JSON_PATH = tempUsersJson;
    resetDbCache();
  });

  afterAll(async () => {
    delete process.env.USERS_JSON_PATH;
    resetDbCache();
    try {
      await fs.unlink(tempUsersJson);
    } catch {}
  });

  it("upgrades hash successfully on exact prior hash match", async () => {
    const testEmail = `cas-test-${Date.now()}@example.com`;
    const user = await createUser(testEmail, "initialPassword123!", "CAS Test User");
    const originalBcryptHash = user.passwordHash;

    const dummyArgon2Hash = "$argon2id$v=19$m=19456,t=2,p=1$fakeSalt$fakeUpgradedHash";

    // CAS upgrade with matching prior hash
    const upgraded = await upgradeUserPasswordHash(user.id, originalBcryptHash, dummyArgon2Hash);
    expect(upgraded).toBe(true);

    const refreshed = await findUserById(user.id);
    expect(refreshed?.passwordHash).toBe(dummyArgon2Hash);
  });

  it("fails upgrade if prior hash does not match (preventing race/overwriting)", async () => {
    const testEmail = `cas-conflict-${Date.now()}@example.com`;
    const user = await createUser(testEmail, "initialPassword123!", "CAS Conflict User");

    const staleHash = "$2b$10$staleHashValueThatDoesNotMatchCurrentRecord1234567890";
    const dummyArgon2Hash = "$argon2id$v=19$m=19456,t=2,p=1$fakeSalt$anotherHash";

    const upgraded = await upgradeUserPasswordHash(user.id, staleHash, dummyArgon2Hash);
    expect(upgraded).toBe(false);

    const refreshed = await findUserById(user.id);
    expect(refreshed?.passwordHash).toBe(user.passwordHash); // Unchanged!
  });
});
