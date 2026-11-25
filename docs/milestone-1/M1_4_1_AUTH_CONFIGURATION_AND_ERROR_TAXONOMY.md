# M1.4.1 — Authentication Architecture, Configuration & Error Taxonomy

**Status:** Completed  
**Milestone:** M1.4 (Sub-stage M1.4.1)  
**Implementation Source:** `backend/src/auth/config.ts`, `backend/src/auth/errors.ts`  
**Test Suite:** `backend/tests/auth-config-errors.test.ts`

---

## 1. Executive Summary

Sub-stage M1.4.1 establishes the foundational configuration contracts, environment parsing rules, startup invariants, and machine-readable error models required for AuraClave's phased authentication migration.

Under this implementation:

- The default production authority remains strictly JSON (`AUTH_AUTHORITY="json"`).
- Existing legacy authentication secrets and token lifecycles remain completely backward-compatible.
- All modern authentication features (`ENABLE_MODERN_JWT`, `ENABLE_REFRESH_SESSIONS`) default to `false` and remain dormant until explicitly enabled by configuration.
- A strongly-typed, standardized error taxonomy maps authentication failures to appropriate HTTP status codes and non-sensitive client messages, eliminating account enumeration risks while preserving internal diagnostic logging.

---

## 2. Centralized Authentication Configuration

The configuration layer in `backend/src/auth/config.ts` uses Zod for type validation, runtime type safety, and environment boundary enforcement.

### 2.1 Configuration Schema & Invariants

| Variable                          | Type                     | Default                   | Description                                             | Invariants & Validation Rules                                                                     |
| --------------------------------- | ------------------------ | ------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `AUTH_AUTHORITY`                  | `"json"` \| `"postgres"` | `"json"`                  | Active authentication storage authority.                | Must remain `"json"` in M1.4. Does not initialize database pools in JSON mode.                    |
| `ENABLE_LEGACY_JWT_COMPATIBILITY` | `boolean`                | `true`                    | Allows verification of legacy HS256 JWTs.               | When `true`, `JWT_SECRET` must be non-empty.                                                      |
| `ENABLE_MODERN_JWT`               | `boolean`                | `false`                   | Enables modern asymmetric (RS256) access token engine.  | When `true`, `JWT_PUBLIC_KEY` must be configured.                                                 |
| `ENABLE_REFRESH_SESSIONS`         | `boolean`                | `false`                   | Enables refresh session family management.              | Disabled by default; does not affect active login.                                                |
| `REJECT_LEGACY_JWT_AFTER`         | `string` (ISO date)      | `undefined`               | Absolute cutoff date for rejecting legacy HS256 tokens. | Must parse as a valid ISO-8601 date string.                                                       |
| `JWT_SECRET`                      | `string`                 | `undefined`               | Legacy symmetric signing secret.                        | Required if `ENABLE_LEGACY_JWT_COMPATIBILITY=true`. Minimum 32 chars in production. Never logged. |
| `JWT_ISSUER`                      | `string`                 | `"auraclave-api"`         | Expected `iss` claim for modern access tokens.          | Validated strictly on incoming RS256 JWTs.                                                        |
| `JWT_AUDIENCE`                    | `string`                 | `"auraclave-app"`         | Expected `aud` claim for modern access tokens.          | Validated strictly on incoming RS256 JWTs.                                                        |
| `JWT_PUBLIC_KEY`                  | `string`                 | `undefined`               | Public verification key (PEM format).                   | Required if `ENABLE_MODERN_JWT=true`.                                                             |
| `JWT_KEY_ID`                      | `string`                 | `"auraclave-key-primary"` | Key ID (`kid`) matching active signing key.             | Validated against JOSE header.                                                                    |
| `ACCESS_TOKEN_TTL_SECONDS`        | `number`                 | `900` (15 min)            | Lifetime for modern access tokens.                      | Bounded between 60 and 86,400 seconds.                                                            |
| `REFRESH_TOKEN_TTL_SECONDS`       | `number`                 | `2592000` (30 days)       | Absolute session family lifetime.                       | Bounded between 300 and 31,536,000 seconds.                                                       |

### 2.2 Security Guarantees

- **No Secret Leakage:** Configuration parsing never interpolates raw secrets into validation error messages or exceptions.
- **Fail-Closed Verification:** If `ENABLE_MODERN_JWT=true` but `JWT_PUBLIC_KEY` is missing, startup fails immediately.
- **Production Guardrails:** When `NODE_ENV=production`, `JWT_SECRET` must be at least 32 characters long.

---

## 3. Typed Authentication Error Taxonomy

The error taxonomy in `backend/src/auth/errors.ts` standardizes error responses across all authentication flows.

### 3.1 Error Codes & HTTP Mapping

| Machine-Readable Code         | HTTP Status | Public Safe Message                                                            | Enumeration Defense / Internal Purpose                                                      |
| ----------------------------- | ----------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `INVALID_CREDENTIALS`         | 400         | "Invalid email or password."                                                   | Standard generic failure for incorrect password or missing user.                            |
| `MISSING_AUTHENTICATION`      | 401         | "Please sign in to continue."                                                  | Returned when Authorization header or bearer token is absent.                               |
| `INVALID_TOKEN`               | 401         | "Your session is invalid. Please sign in again."                               | Signature mismatch, malformed payload, or unknown `kid`.                                    |
| `EXPIRED_TOKEN`               | 401         | "Your session is invalid or has expired. Please sign in again."                | Token lifetime exceeded (`exp` or legacy cutoff passed).                                    |
| `REVOKED_TOKEN`               | 401         | "Your session has been revoked. Please sign in again."                         | Session family revoked or disabled.                                                         |
| `INVALID_REFRESH_TOKEN`       | 401         | "Invalid refresh token. Please sign in again."                                 | Unrecognized refresh token hash.                                                            |
| `REFRESH_TOKEN_REUSE`         | 401         | "Session terminated due to security violation. Please sign in again."          | Replay attack detected; session family immediately revoked.                                 |
| `ACCOUNT_NOT_FOUND`           | 400         | "Invalid email or password."                                                   | **Anti-enumeration:** Maps to generic credential failure to prevent user existence probing. |
| `ACCOUNT_DISABLED`            | 403         | "Your account is currently disabled. Please contact support."                  | Explicitly returned when an account is suspended or deactivated.                            |
| `EMAIL_VERIFICATION_REQUIRED` | 403         | "Please verify your email address to continue."                                | Reserved for future email verification enforcement.                                         |
| `RATE_LIMIT_EXCEEDED`         | 429         | "Too many requests. Please try again later."                                   | Emitted by throttling/abuse middleware.                                                     |
| `AUTH_CONFIG_FAILURE`         | 500         | "Authentication service misconfigured."                                        | Configuration missing required operational variables.                                       |
| `AUTH_DATABASE_UNAVAILABLE`   | 503         | "Authentication service is temporarily unavailable. Please try again shortly." | PostgreSQL outage; **fails closed** without falling back to JSON.                           |
| `INTERNAL_AUTH_FAILURE`       | 500         | "An internal authentication error occurred."                                   | Unhandled operational errors; diagnostics kept internal.                                    |

### 3.2 Error Normalization & Serialization

The `AuthError` class exposes a `.toResponse()` method:

```json
{
  "error": "Invalid email or password.",
  "code": "INVALID_CREDENTIALS"
}
```

Internal diagnostics (such as database error details or token decode issues) are stored strictly on `err.internalDetail` and are never serialized into HTTP client responses.
