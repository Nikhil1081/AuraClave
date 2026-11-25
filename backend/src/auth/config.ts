import { z } from "zod";

export type AuthAuthority = "json" | "postgres";

export interface KeyPairConfig {
  kid: string;
  publicKey: string;
  privateKey?: string;
  revoked?: boolean;
}

const authEnvironmentSchema = z.object({
  AUTH_AUTHORITY: z
    .string()
    .default("json")
    .refine((val) => val === "json", {
      message: "AUTH_AUTHORITY=postgres is not permitted prior to approved cutover. Default authority must remain 'json'.",
    }),
  ENABLE_LEGACY_JWT_COMPATIBILITY: z
    .string()
    .optional()
    .transform((val) => (val !== undefined ? val === "true" || val === "1" : true)),
  ENABLE_MODERN_JWT: z
    .string()
    .optional()
    .transform((val) => (val !== undefined ? val === "true" || val === "1" : false)),
  ENABLE_REFRESH_SESSIONS: z
    .string()
    .optional()
    .transform((val) => (val !== undefined ? val === "true" || val === "1" : false)),
  REJECT_LEGACY_JWT_AFTER: z
    .string()
    .optional()
    .refine(
      (val) => {
        if (!val) return true;
        return !isNaN(Date.parse(val));
      },
      { message: "REJECT_LEGACY_JWT_AFTER must be a valid ISO-8601 date string." }
    ),
  JWT_SECRET: z.string().optional(),
  JWT_ISSUER: z.string().default("auraclave-api"),
  JWT_AUDIENCE: z.string().default("auraclave-app"),
  JWT_PRIVATE_KEY: z.string().optional(),
  JWT_PUBLIC_KEY: z.string().optional(),
  JWT_KEY_ID: z.string().default("auraclave-key-primary"),
  ACCESS_TOKEN_TTL_SECONDS: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 900))
    .refine((val) => !isNaN(val) && val >= 60 && val <= 86400, {
      message: "ACCESS_TOKEN_TTL_SECONDS must be between 60 and 86400.",
    }),
  REFRESH_TOKEN_TTL_SECONDS: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 30 * 86400))
    .refine((val) => !isNaN(val) && val >= 300 && val <= 365 * 86400, {
      message: "REFRESH_TOKEN_TTL_SECONDS must be between 300 and 31536000.",
    }),
  REDIS_URL: z.string().optional(),
  SUCCESSOR_VAULT_ENCRYPTION_KEY: z.string().optional(),
  NODE_ENV: z.string().optional(),
});

export type ValidatedAuthConfig = z.infer<typeof authEnvironmentSchema>;

let cachedAuthConfig: ValidatedAuthConfig | null = null;

/**
 * Parses and validates the centralized authentication configuration from environment variables.
 * Does not leak secrets in error messages or logs.
 */
export function parseAuthConfig(
  env: NodeJS.ProcessEnv = process.env
): ValidatedAuthConfig {
  const parsed = authEnvironmentSchema.safeParse(env);
  if (!parsed.success) {
    const errorMessages = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Authentication configuration error: ${errorMessages}`);
  }

  const config = parsed.data;

  // Invariant 0: PostgreSQL authentication is strictly not authorized until approved cutover
  if ((env.AUTH_AUTHORITY as string) === "postgres") {
    throw new Error(
      "AUTH_AUTHORITY=postgres is not permitted prior to approved cutover. Default authority must remain 'json'."
    );
  }

  // Invariant 1: If legacy compatibility is enabled, JWT_SECRET must be present and non-empty
  if (config.ENABLE_LEGACY_JWT_COMPATIBILITY) {
    if (!config.JWT_SECRET || config.JWT_SECRET.trim().length === 0) {
      throw new Error("JWT_SECRET environment variable is required when legacy JWT compatibility is enabled.");
    }
  }

  // Invariant 2: In production, reject default/weak secrets
  if (config.NODE_ENV === "production" && config.JWT_SECRET) {
    if (config.JWT_SECRET.length < 32) {
      throw new Error("In production, JWT_SECRET must be at least 32 characters long.");
    }
  }

  // Invariant 3: If modern JWT issuance/signing is enabled, validate key existence
  if (config.ENABLE_MODERN_JWT) {
    if (!config.JWT_PUBLIC_KEY || config.JWT_PUBLIC_KEY.trim().length === 0) {
      throw new Error("JWT_PUBLIC_KEY is required when modern JWT functionality is enabled.");
    }
  }

  // Invariant 4: In production, when refresh sessions are enabled, require REDIS_URL and encryption key
  if (config.NODE_ENV === "production" && config.ENABLE_REFRESH_SESSIONS) {
    if (!config.REDIS_URL || config.REDIS_URL.trim().length === 0) {
      throw new Error("REDIS_URL is required in production when refresh sessions are enabled.");
    }
    if (!config.SUCCESSOR_VAULT_ENCRYPTION_KEY || config.SUCCESSOR_VAULT_ENCRYPTION_KEY.length < 32) {
      throw new Error("SUCCESSOR_VAULT_ENCRYPTION_KEY must be at least 32 characters in production.");
    }
  }

  return config;
}

/**
 * Returns the cached or parsed authentication configuration.
 */
export function getAuthConfig(): ValidatedAuthConfig {
  if (!cachedAuthConfig) {
    cachedAuthConfig = parseAuthConfig();
  }
  return cachedAuthConfig;
}

/**
 * Resets the cached configuration (used for testing).
 */
export function resetAuthConfigCache(): void {
  cachedAuthConfig = null;
}
