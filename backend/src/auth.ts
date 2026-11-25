import type { Request } from "express";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import { findUserById, type UserRecord } from "./db.js";

let ephemeralJwtSecret: string | null = null;

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET?.trim();
  if (secret) {
    return secret;
  }
  if (!ephemeralJwtSecret) {
    ephemeralJwtSecret = crypto.randomBytes(32).toString("hex");
    console.error(
      "[SECURITY WARNING] JWT_SECRET environment variable is not set. Using a temporary per-process random secret; set JWT_SECRET in Render Environment Variables for persistent sessions."
    );
  }
  return ephemeralJwtSecret;
}

export function assertAuthConfig(): void {
  getJwtSecret();
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  user_metadata: {
    full_name: string;
    avatar_url?: string;
  };
}

export function generateToken(user: UserRecord): string {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      fullName: user.fullName
    },
    getJwtSecret(),
    { expiresIn: "30d" }
  );
}

export async function getAuthenticatedUser(req: Request): Promise<AuthenticatedUser> {
  const authorization = req.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) {
    throw new Error("Please sign in to continue.");
  }

  const token = authorization.slice("Bearer ".length).trim();
  if (!token) {
    throw new Error("Missing authentication token.");
  }

  try {
    const payload = jwt.verify(token, getJwtSecret()) as {
      id: string;
      email: string;
      fullName?: string;
      avatarUrl?: string;
    };

    // If available in DB, retrieve freshest user data
    const user = await findUserById(payload.id);
    if (user) {
      return {
        id: user.id,
        email: user.email,
        user_metadata: {
          full_name: user.fullName,
          avatar_url: user.avatarUrl || ""
        }
      };
    }

    return {
      id: payload.id,
      email: payload.email,
      user_metadata: {
        full_name: payload.fullName || payload.email.split("@")[0],
        avatar_url: payload.avatarUrl || ""
      }
    };
  } catch (err: any) {
    throw new Error("Your session is invalid or has expired. Please sign in again.");
  }
}
