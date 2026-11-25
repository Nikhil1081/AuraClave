import { and, eq, sql } from "drizzle-orm";
import type { IdentityDatabase } from "../database/client.js";
import {
  authAuditEvents,
  authRefreshTokens,
  authSessionFamilies,
} from "../database/schema.js";
import { AuthError, AuthErrorCode } from "../auth/errors.js";
import { generateOpaqueRefreshToken, hashRefreshToken } from "../auth/refresh-token.js";
import { getSuccessorVault, EphemeralSuccessorVault } from "../auth/successor-vault.js";

export interface CreateSessionFamilyParams {
  userId: string;
  absoluteExpiresAt: Date;
  deviceLabel?: string;
  initialIpAddress?: string;
  initialUserAgent?: string;
  refreshTokenTtlSeconds?: number;
}

export interface RefreshResult {
  rawRefreshToken: string;
  familyId: string;
  userId: string;
  isRetry: boolean;
}

export class SessionService {
  private database: IdentityDatabase;
  private successorVault: EphemeralSuccessorVault;

  constructor(database: IdentityDatabase, successorVault = getSuccessorVault()) {
    this.database = database;
    this.successorVault = successorVault;
  }

  /**
   * Creates a new session family and initial opaque refresh token.
   */
  public async createSessionFamily(params: CreateSessionFamilyParams): Promise<{
    familyId: string;
    rawRefreshToken: string;
  }> {
    return await this.database.transaction(async (tx) => {
      // 1. Create parent session family
      const [family] = await tx
        .insert(authSessionFamilies)
        .values({
          userId: params.userId,
          absoluteExpiresAt: params.absoluteExpiresAt,
          deviceLabel: params.deviceLabel,
          initialIpAddress: params.initialIpAddress,
          initialUserAgent: params.initialUserAgent,
        })
        .returning();

      // 2. Generate opaque refresh token
      const { rawToken, tokenHash } = generateOpaqueRefreshToken();
      const tokenTtlMs = (params.refreshTokenTtlSeconds || 7 * 24 * 3600) * 1000;
      // Cap token expiry by family absolute expiry
      const tokenExpiresAt = new Date(
        Math.min(Date.now() + tokenTtlMs, params.absoluteExpiresAt.getTime())
      );

      // 3. Insert child refresh token record
      await tx.insert(authRefreshTokens).values({
        familyId: family.id,
        tokenHash,
        expiresAt: tokenExpiresAt,
      });

      // 4. Log audit event
      await tx.insert(authAuditEvents).values({
        userId: params.userId,
        eventType: "session_created",
        succeeded: true,
        ipAddress: params.initialIpAddress,
        userAgent: params.initialUserAgent,
        metadata: { familyId: family.id },
      });

      return {
        familyId: family.id,
        rawRefreshToken: rawToken,
      };
    });
  }

  /**
   * Transactional refresh token rotation with bounded idempotent retry and replay detection.
   */
  public async rotateRefreshToken(params: {
    rawRefreshToken: string;
    idempotencyKey?: string;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<RefreshResult> {
    const presentedHash = hashRefreshToken(params.rawRefreshToken);

    // 1. Check for valid idempotent retry in ephemeral encrypted vault
    if (params.idempotencyKey) {
      const cached = await this.successorVault.retrieveSuccessor(
        presentedHash,
        params.idempotencyKey
      );
      if (cached) {
        // Retrieve family to get userId and confirm active
        const [family] = await this.database
          .select()
          .from(authSessionFamilies)
          .where(eq(authSessionFamilies.id, cached.familyId))
          .limit(1);

        if (family && !family.revokedAt && family.absoluteExpiresAt > new Date()) {
          return {
            rawRefreshToken: cached.rawSuccessorToken,
            familyId: cached.familyId,
            userId: family.userId,
            isRetry: true,
          };
        }
      }
    }

    // 2. Perform transactional rotation
    return await this.database.transaction(async (tx) => {
      // Find token record
      const [tokenRecord] = await tx
        .select()
        .from(authRefreshTokens)
        .where(eq(authRefreshTokens.tokenHash, presentedHash))
        .limit(1);

      if (!tokenRecord) {
        throw new AuthError(
          AuthErrorCode.INVALID_REFRESH_TOKEN,
          "Refresh token hash not recognized"
        );
      }

      // Lock family record: SELECT ... FOR UPDATE
      const [family] = await tx
        .select()
        .from(authSessionFamilies)
        .where(eq(authSessionFamilies.id, tokenRecord.familyId))
        .for("update")
        .limit(1);

      if (!family) {
        throw new AuthError(
          AuthErrorCode.INVALID_REFRESH_TOKEN,
          "Associated session family not found"
        );
      }

      // Check if family is already revoked or expired
      if (family.revokedAt) {
        throw new AuthError(
          AuthErrorCode.REVOKED_TOKEN,
          `Session family revoked: ${family.revokedReason || "unspecified"}`
        );
      }
      if (new Date() > family.absoluteExpiresAt) {
        throw new AuthError(
          AuthErrorCode.EXPIRED_TOKEN,
          "Session family has exceeded absolute expiration"
        );
      }

      // 3. REPLAY DETECTION: Token already consumed!
      if (tokenRecord.consumedAt) {
        // Replay confirmed! Revoke entire family immediately
        const revokeReason = "replay_detected";
        await tx
          .update(authSessionFamilies)
          .set({ revokedAt: new Date(), revokedReason: revokeReason })
          .where(eq(authSessionFamilies.id, family.id));

        // Audit event
        await tx.insert(authAuditEvents).values({
          userId: family.userId,
          eventType: "refresh_token_replay",
          succeeded: false,
          ipAddress: params.ipAddress,
          userAgent: params.userAgent,
          metadata: {
            familyId: family.id,
            tokenId: tokenRecord.id,
            idempotencyKey: params.idempotencyKey,
          },
        });

        throw new AuthError(
          AuthErrorCode.REFRESH_TOKEN_REUSE,
          "Presented refresh token has already been consumed (theft suspected)"
        );
      }

      // Check token expiration
      if (new Date() > tokenRecord.expiresAt) {
        throw new AuthError(
          AuthErrorCode.EXPIRED_TOKEN,
          "Refresh token generation has expired"
        );
      }

      // 4. Mark presented token consumed
      const now = new Date();
      await tx
        .update(authRefreshTokens)
        .set({
          consumedAt: now,
          idempotencyKey: params.idempotencyKey,
        })
        .where(
          and(
            eq(authRefreshTokens.id, tokenRecord.id),
            sql`${authRefreshTokens.consumedAt} IS NULL`
          )
        );

      // 5. Generate successor token
      const { rawToken: rawSuccessorToken, tokenHash: successorHash } =
        generateOpaqueRefreshToken();
      const tokenTtlMs = 7 * 24 * 3600 * 1000; // 7 days inactivity
      const successorExpiresAt = new Date(
        Math.min(now.getTime() + tokenTtlMs, family.absoluteExpiresAt.getTime())
      );

      await tx.insert(authRefreshTokens).values({
        familyId: family.id,
        tokenHash: successorHash,
        parentTokenId: tokenRecord.id,
        expiresAt: successorExpiresAt,
      });

      // Update family lastActiveAt
      await tx
        .update(authSessionFamilies)
        .set({ lastActiveAt: now })
        .where(eq(authSessionFamilies.id, family.id));

      // Audit event
      await tx.insert(authAuditEvents).values({
        userId: family.userId,
        eventType: "token_rotated",
        succeeded: true,
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
        metadata: { familyId: family.id },
      });

      // 6. Cache successor in vault for 30s idempotent retry
      if (params.idempotencyKey) {
        await this.successorVault.storeSuccessor(
          presentedHash,
          params.idempotencyKey,
          rawSuccessorToken,
          family.id,
          30
        );
      }

      return {
        rawRefreshToken: rawSuccessorToken,
        familyId: family.id,
        userId: family.userId,
        isRetry: false,
      };
    });
  }

  /**
   * Revokes a session family (e.g. user logout).
   */
  public async revokeFamily(familyId: string, reason = "user_logout"): Promise<boolean> {
    const [revoked] = await this.database
      .update(authSessionFamilies)
      .set({ revokedAt: new Date(), revokedReason: reason })
      .where(
        and(
          eq(authSessionFamilies.id, familyId),
          sql`${authSessionFamilies.revokedAt} IS NULL`
        )
      )
      .returning();

    return !!revoked;
  }

  /**
   * Revokes all session families for a given user (e.g. logout all devices or password change).
   */
  public async revokeAllUserFamilies(userId: string, reason = "revoke_all_devices"): Promise<number> {
    const revoked = await this.database
      .update(authSessionFamilies)
      .set({ revokedAt: new Date(), revokedReason: reason })
      .where(
        and(
          eq(authSessionFamilies.userId, userId),
          sql`${authSessionFamilies.revokedAt} IS NULL`
        )
      )
      .returning();

    return revoked.length;
  }
}
