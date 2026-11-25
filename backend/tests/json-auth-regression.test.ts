import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import express from "express";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { createUser, findUserByEmail, findUserById, resetDbCache } from "../src/db.js";
import { generateToken, getAuthenticatedUser } from "../src/auth.js";
import { parseAuthConfig } from "../src/auth/config.js";

describe("M1.4 Operational JSON Authentication Regression", () => {
  let tempUsersJson: string;

  beforeAll(async () => {
    process.env.JWT_SECRET = "ci-test-secret-do-not-use-in-production";
    tempUsersJson = path.join(os.tmpdir(), `test-users-${Date.now()}.json`);
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

  const app = express();
  app.use(express.json());

  app.post("/api/auth/signup", async (req, res) => {
    try {
      const { email, password, name } = req.body ?? {};
      if (!email || !email.includes("@")) {
        return res.status(400).json({ error: "Please provide a valid email address." });
      }
      if (!password || password.length < 6) {
        return res.status(400).json({ error: "Password must be at least 6 characters long." });
      }
      const user = await createUser(email, password, name || "");
      const token = generateToken(user);
      return res.status(201).json({ user, token });
    } catch (err: any) {
      return res.status(400).json({ error: err.message || "Sign up failed." });
    }
  });

  app.post("/api/auth/login", async (req, res) => {
    try {
      const { email, password } = req.body ?? {};
      if (!email || !password) {
        return res.status(400).json({ error: "Please enter your email and password." });
      }
      const user = await findUserByEmail(email);
      if (!user) {
        return res.status(400).json({ error: "Invalid email or password." });
      }
      const bcrypt = (await import("bcryptjs")).default;
      const valid = await bcrypt.compare(password, user.passwordHash);
      if (!valid) {
        return res.status(400).json({ error: "Invalid email or password." });
      }
      const token = generateToken(user);
      return res.status(200).json({ user, token });
    } catch (err: any) {
      return res.status(400).json({ error: err.message || "Login failed." });
    }
  });

  app.get("/api/auth/me", async (req, res) => {
    try {
      const user = await getAuthenticatedUser(req as any);
      return res.status(200).json({ user });
    } catch (err: any) {
      return res.status(401).json({ error: err.message || "Not authenticated." });
    }
  });

  it("proves JSON mode does not require DATABASE_URL", () => {
    const config = parseAuthConfig({
      JWT_SECRET: "ci-test-secret-do-not-use-in-production",
      // Notice: DATABASE_URL is undefined
    });
    expect(config.AUTH_AUTHORITY).toBe("json");
  });

  it("executes complete signup, login, and /me lifecycle identically to baseline", async () => {
    const email = `regression-${Date.now()}@example.com`;
    const password = "RegressionPassword123!";

    // 1. Sign up
    const signupRes = await request(app)
      .post("/api/auth/signup")
      .send({ email, password, name: "Regression Tester" });

    expect(signupRes.status).toBe(201);
    expect(signupRes.body.token).toBeDefined();
    expect(signupRes.body.user.email).toBe(email);

    const token = signupRes.body.token;

    // 2. Login
    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ email, password });

    expect(loginRes.status).toBe(200);
    expect(loginRes.body.token).toBeDefined();

    // 3. Authenticate /me with Bearer token
    const meRes = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${token}`);

    expect(meRes.status).toBe(200);
    expect(meRes.body.user.email).toBe(email);
  });
});
