import crypto from "crypto";

export interface OpaqueRefreshToken {
  rawToken: string;
  tokenHash: string;
}

/**
 * Generates a cryptographically secure opaque refresh token.
 * Requirements:
 * - At least 256 bits (32 bytes) of secure entropy.
 * - Base64url encoding for safe HTTP transport.
 * - SHA-256 one-way cryptographic digest for storage.
 * - Raw token is NEVER stored in database.
 */
export function generateOpaqueRefreshToken(): OpaqueRefreshToken {
  const bytes = crypto.randomBytes(32); // 256 bits of entropy
  const rawToken = bytes.toString("base64url");
  const tokenHash = hashRefreshToken(rawToken);

  return {
    rawToken,
    tokenHash,
  };
}

/**
 * Computes the SHA-256 hex digest of a raw refresh token.
 */
export function hashRefreshToken(rawToken: string): string {
  if (!rawToken || typeof rawToken !== "string") {
    throw new Error("Invalid raw refresh token provided for hashing");
  }
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}
