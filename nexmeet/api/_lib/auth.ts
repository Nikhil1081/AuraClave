import type { VercelRequest } from "@vercel/node";

export async function getAuthenticatedUser(req: VercelRequest) {
  const authorization = req.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) {
    throw new Error("Please sign in to continue.");
  }

  const token = authorization.slice("Bearer ".length).trim();
  if (!token) {
    throw new Error("Missing session token.");
  }

  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("Your session token is malformed. Please sign in again.");
  }

  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64").toString("utf-8"));
    if (!payload.id || !payload.email) {
      throw new Error("Invalid session token claims.");
    }

    return {
      id: payload.id,
      email: payload.email,
      user_metadata: {
        full_name: payload.fullName || payload.email.split("@")[0]
      }
    };
  } catch (err: any) {
    throw new Error("Your session has expired or is invalid. Please sign in again.");
  }
}
