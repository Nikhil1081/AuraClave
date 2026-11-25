/**
 * Machine-readable stable error codes for AuraClave authentication.
 */
export const AuthErrorCode = {
  INVALID_CREDENTIALS: "INVALID_CREDENTIALS",
  MISSING_AUTHENTICATION: "MISSING_AUTHENTICATION",
  INVALID_TOKEN: "INVALID_TOKEN",
  EXPIRED_TOKEN: "EXPIRED_TOKEN",
  REVOKED_TOKEN: "REVOKED_TOKEN",
  INVALID_REFRESH_TOKEN: "INVALID_REFRESH_TOKEN",
  REFRESH_TOKEN_REUSE: "REFRESH_TOKEN_REUSE",
  ACCOUNT_NOT_FOUND: "ACCOUNT_NOT_FOUND",
  ACCOUNT_DISABLED: "ACCOUNT_DISABLED",
  EMAIL_VERIFICATION_REQUIRED: "EMAIL_VERIFICATION_REQUIRED",
  RATE_LIMIT_EXCEEDED: "RATE_LIMIT_EXCEEDED",
  AUTH_CONFIG_FAILURE: "AUTH_CONFIG_FAILURE",
  AUTH_DATABASE_UNAVAILABLE: "AUTH_DATABASE_UNAVAILABLE",
  INTERNAL_AUTH_FAILURE: "INTERNAL_AUTH_FAILURE",
} as const;

export type AuthErrorCode = (typeof AuthErrorCode)[keyof typeof AuthErrorCode];

export interface AuthErrorMetadata {
  httpStatus: number;
  safeMessage: string;
}

const ERROR_METADATA_MAP: Record<AuthErrorCode, AuthErrorMetadata> = {
  [AuthErrorCode.INVALID_CREDENTIALS]: {
    httpStatus: 400,
    safeMessage: "Invalid email or password.",
  },
  [AuthErrorCode.MISSING_AUTHENTICATION]: {
    httpStatus: 401,
    safeMessage: "Please sign in to continue.",
  },
  [AuthErrorCode.INVALID_TOKEN]: {
    httpStatus: 401,
    safeMessage: "Your session is invalid. Please sign in again.",
  },
  [AuthErrorCode.EXPIRED_TOKEN]: {
    httpStatus: 401,
    safeMessage: "Your session is invalid or has expired. Please sign in again.",
  },
  [AuthErrorCode.REVOKED_TOKEN]: {
    httpStatus: 401,
    safeMessage: "Your session has been revoked. Please sign in again.",
  },
  [AuthErrorCode.INVALID_REFRESH_TOKEN]: {
    httpStatus: 401,
    safeMessage: "Invalid refresh token. Please sign in again.",
  },
  [AuthErrorCode.REFRESH_TOKEN_REUSE]: {
    httpStatus: 401,
    safeMessage: "Session terminated due to security violation. Please sign in again.",
  },
  [AuthErrorCode.ACCOUNT_NOT_FOUND]: {
    httpStatus: 400,
    safeMessage: "Invalid email or password.", // Generic to prevent enumeration
  },
  [AuthErrorCode.ACCOUNT_DISABLED]: {
    httpStatus: 403,
    safeMessage: "Your account is currently disabled. Please contact support.",
  },
  [AuthErrorCode.EMAIL_VERIFICATION_REQUIRED]: {
    httpStatus: 403,
    safeMessage: "Please verify your email address to continue.",
  },
  [AuthErrorCode.RATE_LIMIT_EXCEEDED]: {
    httpStatus: 429,
    safeMessage: "Too many requests. Please try again later.",
  },
  [AuthErrorCode.AUTH_CONFIG_FAILURE]: {
    httpStatus: 500,
    safeMessage: "Authentication service misconfigured.",
  },
  [AuthErrorCode.AUTH_DATABASE_UNAVAILABLE]: {
    httpStatus: 503,
    safeMessage: "Authentication service is temporarily unavailable. Please try again shortly.",
  },
  [AuthErrorCode.INTERNAL_AUTH_FAILURE]: {
    httpStatus: 500,
    safeMessage: "An internal authentication error occurred.",
  },
};

/**
 * Base custom error class for typed authentication errors.
 * Guarantees that internal diagnostic information is kept separate from client responses.
 */
export class AuthError extends Error {
  public readonly code: AuthErrorCode;
  public readonly httpStatus: number;
  public readonly safeMessage: string;
  public readonly internalDetail?: string;

  constructor(code: AuthErrorCode, internalDetail?: string, customSafeMessage?: string) {
    const meta = ERROR_METADATA_MAP[code] || {
      httpStatus: 500,
      safeMessage: "An authentication error occurred.",
    };
    super(customSafeMessage || meta.safeMessage);
    this.name = "AuthError";
    this.code = code;
    this.httpStatus = meta.httpStatus;
    this.safeMessage = customSafeMessage || meta.safeMessage;
    this.internalDetail = internalDetail;

    Object.setPrototypeOf(this, new.target.prototype);
  }

  /**
   * Serializes the error safely for HTTP response bodies.
   * Strips out internal diagnostic details, stack traces, and secrets.
   */
  public toResponse(): { error: string; code: string } {
    return {
      error: this.safeMessage,
      code: this.code,
    };
  }
}

/**
 * Normalizes any error caught in auth routes into a safe AuthError.
 */
export function normalizeAuthError(err: unknown): AuthError {
  if (err instanceof AuthError) {
    return err;
  }
  const message = err instanceof Error ? err.message : String(err);
  return new AuthError(AuthErrorCode.INTERNAL_AUTH_FAILURE, message);
}
