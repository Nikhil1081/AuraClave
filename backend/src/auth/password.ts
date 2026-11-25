import bcrypt from "bcryptjs";
import { hash as argon2Hash, verify as argon2Verify, type Options as Argon2Options } from "@node-rs/argon2";
import { AuthError, AuthErrorCode } from "./errors.js";

export type HashAlgorithm = "bcrypt" | "argon2id" | "unknown";

export interface PasswordVerificationResult {
  valid: boolean;
  algorithm: HashAlgorithm;
  needsUpgrade: boolean;
  upgradedHash?: string;
}

export interface Argon2Config {
  memoryCost: number; // in KiB (e.g., 19456 = 19 MiB)
  timeCost: number;   // iterations (e.g., 2)
  parallelism: number; // threads (e.g., 1)
  outputLen?: number;
}

/**
 * OWASP recommended baseline parameters for Argon2id.
 */
export const DEFAULT_ARGON2_CONFIG: Argon2Config = {
  memoryCost: 19456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
};

/**
 * Detects the password hash algorithm from standard PHC string prefixes.
 */
export function identifyHashAlgorithm(hash: string): HashAlgorithm {
  if (typeof hash !== "string") return "unknown";
  if (hash.startsWith("$argon2id$") || hash.startsWith("$argon2i$") || hash.startsWith("$argon2d$")) {
    return "argon2id";
  }
  if (
    hash.startsWith("$2a$") ||
    hash.startsWith("$2b$") ||
    hash.startsWith("$2y$") ||
    hash.startsWith("$2x$")
  ) {
    return "bcrypt";
  }
  return "unknown";
}

export class PasswordService {
  private readonly argon2Config: Argon2Config;

  constructor(argon2Config: Argon2Config = DEFAULT_ARGON2_CONFIG) {
    this.argon2Config = argon2Config;
  }

  /**
   * Hashes a new password using modern Argon2id.
   */
  public async hashPassword(password: string): Promise<string> {
    if (typeof password !== "string" || password.length === 0) {
      throw new AuthError(
        AuthErrorCode.INVALID_CREDENTIALS,
        "Password must be a non-empty string"
      );
    }

    try {
      return await argon2Hash(password, {
        memoryCost: this.argon2Config.memoryCost,
        timeCost: this.argon2Config.timeCost,
        parallelism: this.argon2Config.parallelism,
        outputLen: this.argon2Config.outputLen,
      });
    } catch (err: unknown) {
      throw new AuthError(
        AuthErrorCode.INTERNAL_AUTH_FAILURE,
        `Argon2id hashing failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  /**
   * Verifies a password against an existing hash (bcrypt or Argon2id).
   * Determines whether the hash requires upgrade to Argon2id.
   * If valid and legacy bcrypt, generates the replacement Argon2id hash.
   */
  public async verifyPassword(
    password: string,
    existingHash: string
  ): Promise<PasswordVerificationResult> {
    if (!password || !existingHash) {
      return {
        valid: false,
        algorithm: "unknown",
        needsUpgrade: false,
      };
    }

    const algorithm = identifyHashAlgorithm(existingHash);

    if (algorithm === "bcrypt") {
      try {
        const valid = await bcrypt.compare(password, existingHash);
        if (!valid) {
          return {
            valid: false,
            algorithm: "bcrypt",
            needsUpgrade: false,
          };
        }

        // Successfully verified bcrypt: needs upgrade to Argon2id
        const upgradedHash = await this.hashPassword(password);
        return {
          valid: true,
          algorithm: "bcrypt",
          needsUpgrade: true,
          upgradedHash,
        };
      } catch {
        return {
          valid: false,
          algorithm: "bcrypt",
          needsUpgrade: false,
        };
      }
    }

    if (algorithm === "argon2id") {
      try {
        const valid = await argon2Verify(existingHash, password);
        return {
          valid,
          algorithm: "argon2id",
          needsUpgrade: false,
        };
      } catch {
        return {
          valid: false,
          algorithm: "argon2id",
          needsUpgrade: false,
        };
      }
    }

    // Unknown or unsupported algorithm: fail closed
    return {
      valid: false,
      algorithm: "unknown",
      needsUpgrade: false,
    };
  }
}

let defaultPasswordService: PasswordService | null = null;

export function getPasswordService(): PasswordService {
  if (!defaultPasswordService) {
    defaultPasswordService = new PasswordService();
  }
  return defaultPasswordService;
}
