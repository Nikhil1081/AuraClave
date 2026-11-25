import jwt from "jsonwebtoken";
import crypto from "crypto";
import { AuthError, AuthErrorCode } from "./errors.js";
import { type ValidatedAuthConfig } from "./config.js";
import { KeyManager } from "./key-manager.js";

export interface LegacyJwtPayload {
  id: string;
  email: string;
  fullName?: string;
  avatarUrl?: string;
}

export interface ModernJwtPayload {
  sub: string;
  iss: string;
  aud: string;
  iat: number;
  exp: number;
  nbf?: number;
  jti: string;
  sid: string;
  token_use: "access";
}

export type VerifiedToken =
  | { profile: "legacy"; payload: LegacyJwtPayload }
  | { profile: "modern"; payload: ModernJwtPayload };

export class JwtEngine {
  private config: ValidatedAuthConfig;
  private keyManager: KeyManager;

  constructor(config: ValidatedAuthConfig, keyManager: KeyManager) {
    this.config = config;
    this.keyManager = keyManager;
  }

  /**
   * Generates a legacy HS256 JWT using JWT_SECRET (30-day lifetime).
   */
  public generateLegacyToken(payload: { id: string; email: string; fullName?: string; avatarUrl?: string }): string {
    if (!this.config.JWT_SECRET) {
      throw new AuthError(
        AuthErrorCode.AUTH_CONFIG_FAILURE,
        "JWT_SECRET is required to generate legacy JWTs"
      );
    }

    return jwt.sign(
      {
        id: payload.id,
        email: payload.email,
        fullName: payload.fullName,
        avatarUrl: payload.avatarUrl,
      },
      this.config.JWT_SECRET,
      {
        algorithm: "HS256",
        expiresIn: "30d",
      }
    );
  }

  /**
   * Generates a modern RS256 access JWT (10-15 min lifetime).
   */
  public generateModernAccessToken(params: {
    userId: string;
    sessionId: string;
  }): string {
    if (!this.config.ENABLE_MODERN_JWT) {
      throw new AuthError(
        AuthErrorCode.AUTH_CONFIG_FAILURE,
        "Modern JWT issuance is not enabled"
      );
    }

    const signingKey = this.keyManager.getPrimarySigningKey();
    if (!signingKey || !signingKey.privateKey) {
      throw new AuthError(
        AuthErrorCode.AUTH_CONFIG_FAILURE,
        "No active asymmetric private signing key available"
      );
    }

    const now = Math.floor(Date.now() / 1000);
    const ttl = this.config.ACCESS_TOKEN_TTL_SECONDS;

    const payload: ModernJwtPayload = {
      sub: params.userId,
      iss: this.config.JWT_ISSUER,
      aud: this.config.JWT_AUDIENCE,
      iat: now,
      nbf: now,
      exp: now + ttl,
      jti: crypto.randomUUID(),
      sid: params.sessionId,
      token_use: "access",
    };

    return jwt.sign(payload, signingKey.privateKey, {
      algorithm: "RS256",
      keyid: signingKey.kid,
      header: {
        alg: "RS256",
        typ: "at+jwt",
        kid: signingKey.kid,
      },
    });
  }

  /**
   * Verifies an incoming token using dual verification profiles with strict cryptographic isolation.
   */
  public verifyToken(token: string): VerifiedToken {
    if (!token || typeof token !== "string") {
      throw new AuthError(AuthErrorCode.MISSING_AUTHENTICATION, "Token is required");
    }

    // Inspect header safely without verifying signature yet
    const decoded = jwt.decode(token, { complete: true });
    if (!decoded || !decoded.header || !decoded.payload) {
      throw new AuthError(AuthErrorCode.INVALID_TOKEN, "Malformed JWT structure");
    }

    const alg = decoded.header.alg;

    // Strict Isolation: Route based on algorithm
    if (alg === "HS256") {
      return this.verifyLegacyProfile(token);
    } else if (alg === "RS256") {
      return this.verifyModernProfile(token, decoded.header.kid);
    } else {
      throw new AuthError(
        AuthErrorCode.INVALID_TOKEN,
        `Unsupported JWT algorithm: ${alg}. Expected HS256 or RS256.`
      );
    }
  }

  /**
   * Profile A: Legacy HS256 Verification Profile.
   */
  private verifyLegacyProfile(token: string): VerifiedToken {
    if (!this.config.ENABLE_LEGACY_JWT_COMPATIBILITY) {
      throw new AuthError(
        AuthErrorCode.REVOKED_TOKEN,
        "Legacy HS256 tokens are disabled"
      );
    }

    if (this.config.REJECT_LEGACY_JWT_AFTER) {
      const cutoffTime = Date.parse(this.config.REJECT_LEGACY_JWT_AFTER);
      if (Date.now() > cutoffTime) {
        throw new AuthError(
          AuthErrorCode.EXPIRED_TOKEN,
          "Legacy HS256 token rejected past cutoff date"
        );
      }
    }

    if (!this.config.JWT_SECRET) {
      throw new AuthError(
        AuthErrorCode.AUTH_CONFIG_FAILURE,
        "JWT_SECRET is missing for legacy verification"
      );
    }

    try {
      const payload = jwt.verify(token, this.config.JWT_SECRET, {
        algorithms: ["HS256"], // Pin algorithm: Prevents algorithm confusion
      }) as LegacyJwtPayload;

      if (!payload.id || !payload.email) {
        throw new AuthError(
          AuthErrorCode.INVALID_TOKEN,
          "Legacy token missing mandatory id or email claims"
        );
      }

      return {
        profile: "legacy",
        payload,
      };
    } catch (err: unknown) {
      if (err instanceof AuthError) throw err;
      if (err instanceof jwt.TokenExpiredError) {
        throw new AuthError(AuthErrorCode.EXPIRED_TOKEN, "Legacy JWT has expired");
      }
      throw new AuthError(AuthErrorCode.INVALID_TOKEN, "Legacy JWT verification failed");
    }
  }

  /**
   * Profile B: Modern RS256 Verification Profile.
   */
  private verifyModernProfile(token: string, kid?: string): VerifiedToken {
    if (!kid) {
      throw new AuthError(
        AuthErrorCode.INVALID_TOKEN,
        "Modern RS256 token missing mandatory 'kid' header"
      );
    }

    const verificationKey = this.keyManager.getVerificationKey(kid);
    if (!verificationKey || !verificationKey.publicKey) {
      throw new AuthError(
        AuthErrorCode.INVALID_TOKEN,
        `Verification key for kid '${kid}' not found or revoked`
      );
    }

    try {
      const payload = jwt.verify(token, verificationKey.publicKey, {
        algorithms: ["RS256"], // Strictly RS256: Symmetric keys NEVER accepted here
        issuer: this.config.JWT_ISSUER,
        audience: this.config.JWT_AUDIENCE,
        clockTolerance: 60, // Bounded clock skew: maximum 60 seconds
      }) as ModernJwtPayload;

      // Validate required modern payload claims
      if (!payload.sub || !payload.sid) {
        throw new AuthError(
          AuthErrorCode.INVALID_TOKEN,
          "Modern token missing mandatory 'sub' or 'sid' claims"
        );
      }

      if (payload.token_use !== "access") {
        throw new AuthError(
          AuthErrorCode.INVALID_TOKEN,
          `Invalid token_use claim: expected 'access', received '${payload.token_use}'`
        );
      }

      return {
        profile: "modern",
        payload,
      };
    } catch (err: unknown) {
      if (err instanceof AuthError) throw err;
      if (err instanceof jwt.TokenExpiredError) {
        throw new AuthError(AuthErrorCode.EXPIRED_TOKEN, "Modern access token has expired");
      }
      throw new AuthError(
        AuthErrorCode.INVALID_TOKEN,
        `Modern JWT verification failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
}
