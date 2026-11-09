import type { Request } from "express";
import jwt from "jsonwebtoken";
import { findUserById, type UserRecord } from "./db.js";

const JWT_SECRET = process.env.JWT_SECRET || "auraclave-production-super-secret-key-2026";

export interface AuthenticatedUser {
  id: string;
  email: string;
  user_metadata: {
    full_name: string;
  };
}

export function generateToken(user: UserRecord): string {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      fullName: user.fullName
    },
    JWT_SECRET,
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
    const payload = jwt.verify(token, JWT_SECRET) as {
      id: string;
      email: string;
      fullName?: string;
    };

    return {
      id: payload.id,
      email: payload.email,
      user_metadata: {
        full_name: payload.fullName || payload.email.split("@")[0]
      }
    };
  } catch (err: any) {
    throw new Error("Your session is invalid or has expired. Please sign in again.");
  }
}
