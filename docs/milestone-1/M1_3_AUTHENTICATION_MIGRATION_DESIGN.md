# M1.3 - Authentication Migration Design & Compatibility Planning

**Status:** Design for review; no authentication implementation or cutover authorized
**Repository state reviewed:** `feature/milestone-1-foundation` at `5e38fe0076caeb2a536e1a60925c92111a97bd8b`
**Design boundary:** JSON-backed authentication remains active. This document proposes future work only; it does not change application behavior, schema, or migration state.

## Evidence labels

- **Verified current behavior** means it was observed in the checked-in source or the current working tree during this review.
- **Proposed target** means a design recommendation, not implemented functionality.
- **Assumption** means a point to confirm before implementation.
- **Approval required** means a product/security/operations decision must be recorded before the dependent stage.

No email addresses, user IDs, password hashes, tokens, credentials, or environment values have been copied into this document.

## 1. Executive summary

AuraClave currently authenticates through a small Express API and a JSON user file. Signup and login return a 30-day signed JWT. Passwords are bcrypt hashes. The web client stores the bearer token in `localStorage`; the shipped Expo app stores its bearer token in Expo SecureStore. Logout is local client cleanup, not server-side revocation. There is no active refresh-token flow, email-verification flow, or password-reset flow in the inspected Express routes.

The PostgreSQL/Drizzle schema and repositories are a foundation, not the live authentication authority. `server.ts` imports JSON persistence from `db.ts`; it does not import the PostgreSQL identity repository. The M1.2 migration utility is separate from API traffic and is intentionally limited to loopback databases whose names contain `test` or `disposable`.

**Proposed target:** preserve user UUIDs and bcrypt hashes; introduce an algorithm-aware password verifier that can accept bcrypt and Argon2id; upgrade a bcrypt hash only after successful password verification; issue short-lived JWT access tokens; and use opaque, rotating, hashed refresh tokens in server-side session families. Web and mobile clients need different refresh-token transport/storage while retaining the existing user and product APIs where practical.

The migration must be staged, measured, and reversible. Existing 30-day JWTs are stateless and cannot be converted into refresh-token sessions. The safest cutover is an announced reauthentication boundary: legacy tokens stop being accepted by the new verifier, and users sign in again to create managed sessions. A rollback must not point at a stale JSON snapshot after PostgreSQL identity writes have occurred; it requires a tested reverse reconciliation or a decision to roll forward.

## 2. Current-state architecture

### 2.1 Verified architecture

```mermaid
flowchart LR
    Web["React web client"]
    Mobile["Expo app"]
    API["Express API"]
    JSON["backend/data/users.json<br/>process-local Map cache"]
    JWT["JWT_SECRET<br/>30-day bearer JWT"]
    PG["PostgreSQL / Drizzle<br/>foundation only"]
    Migration["Standalone M1.2 migration CLI"]

    Web -->|"signup/login; token kept in localStorage"| API
    Mobile -->|"signup/login; token kept in SecureStore"| API
    API -->|"create, find, update, bcrypt verify"| JSON
    API -->|"sign / verify"| JWT
    API -. "not used by active auth routes" .-> PG
    Migration -->|"manual, guarded rehearsal only"| PG
    Migration -->|"read-only source"| JSON
```

### 2.2 Backend findings

| Area | Verified current behavior and source | Migration implication |
|---|---|---|
| JSON identity store | [`backend/src/db.ts`](../../backend/src/db.ts): `UserRecord`, `ensureDb`, `persist`, `findUserByEmail`, `findUserById`, `createUser`, `updateUserProfile`, `verifyPassword`. The file is parsed into a process-local `Map`; writes use a temporary file followed by rename. New IDs are created with `crypto.randomUUID()`. The map is keyed by `email.toLowerCase()`. Lookups and new signup use `trim().toLowerCase()`, while pre-existing source email values are not rewritten when loaded. | The JSON store is not a multi-process transactional database. Signup/profile writes can race across API processes, and a process-local cache can become stale. Before a final snapshot, identity writes must be quiesced. Validate and reconcile email normalization; do not assume the runtime map has enforced target uniqueness. |
| Current source data | At this inspection `backend/data/users.json` was an array with one record. The field set was `id`, `email`, `passwordHash`, `fullName`, `createdAt`; the UUID was valid, the observed hash format was bcrypt `$2b$` cost 10, email was already normalized, and `avatarUrl` was absent. Only these structural facts are recorded; values are intentionally omitted. | This is a point-in-time observation, not an import count guarantee. Recount and validate a protected snapshot at migration time. Existing user UUIDs must be preserved. |
| Signup | [`backend/src/server.ts`](../../backend/src/server.ts), `POST /api/auth/signup`: validates an email using a basic `includes("@")` check and requires a password of at least six characters; calls JSON `createUser`; returns `{ user, token }` with HTTP 201. Duplicate email errors are returned to the caller. | Preserve the current response shape during a compatibility stage. Improve validation and enumeration behavior separately, with UI and API tests. Do not mark legacy accounts verified unless evidence exists. |
| Password creation and verification | [`backend/src/db.ts`](../../backend/src/db.ts): `createUser` uses `bcrypt.genSalt(10)` and `bcrypt.hash`; `verifyPassword` uses `bcrypt.compare`. The current function does not explicitly dispatch on an encoded hash algorithm. | New Argon2id hashes require an algorithm-aware verifier before any new Argon2id hashes are written. Keep legacy bcrypt readable. Never bulk-rehash or rewrite a hash without successful verification of the user's password. |
| Login | [`backend/src/server.ts`](../../backend/src/server.ts), `POST /api/auth/login`: looks up the JSON record, verifies the bcrypt hash, and returns `{ user, token }`. Missing user and wrong password share the response text "Invalid email or password." and HTTP 400. There is no rate-limit middleware in the inspected server/package configuration. | Preserve generic credential errors. Add account/IP throttling and abuse monitoring without revealing whether an email exists. |
| JWT creation | [`backend/src/auth.ts`](../../backend/src/auth.ts), `generateToken`: signs custom `id`, `email`, and `fullName` claims using `JWT_SECRET`; `expiresIn` is `"30d"`. `jsonwebtoken` defaults to HS256 for this signing call; the code does not specify issuer, audience, key ID, or an algorithm allowlist for verification. | Existing tokens are long-lived and do not identify a server-side session. Define a distinct new token profile and explicit verification requirements; do not assume the current token meets the proposed access-token contract. |
| Authentication lookup | [`backend/src/auth.ts`](../../backend/src/auth.ts), `getAuthenticatedUser`: accepts a Bearer header, calls `jwt.verify`, then looks up the user in JSON. If that user is absent, it falls back to email/name claims in the token. The verified payload is cast to a TypeScript shape rather than validated against an application claim schema. Errors are normalized to an invalid/expired-session message. | A database-backed verifier must not silently fall back to stale JWT claims or the JSON store. Select exactly one identity authority per deployment mode and fail closed on invalid claims. |
| Profile | [`backend/src/server.ts`](../../backend/src/server.ts), `PATCH /api/auth/profile`: updates JSON profile fields and issues a new 30-day token. The web client applies a local profile override optimistically and may retain it when backend sync fails. | Keep current profile and meeting payload shapes compatible. Define the authoritative update and token refresh semantics before switching repositories. |
| Current-user endpoint | `GET /api/auth/me` in [`backend/src/server.ts`](../../backend/src/server.ts) returns `{ user }` after Bearer authentication. | This is the existing session-restoration contract used by both clients. Preserve or version it deliberately. |
| Logout, refresh, reset, verification | The inspected auth routes in `server.ts` include signup, login, profile, and `/me`; there are no active logout, refresh, password-reset, or email-verification routes. The JSON `UserRecord` has no status, verification, reset-token, session, or refresh-token fields. | Do not claim these features are currently available. Adding them is an API and client change and needs email-provider, policy, and UX decisions. |
| Environment and database use | [`backend/src/lib/env.ts`](../../backend/src/lib/env.ts) and `assertAuthConfig` require a non-empty `JWT_SECRET`; no minimum entropy/length is enforced in these checks. [`backend/src/database/client.ts`](../../backend/src/database/client.ts) creates its pool lazily through `getDatabase`. The active server imports `db.ts`, not the PostgreSQL repository. | Keep `DATABASE_URL` optional for JSON-mode startup. Add target signing-key validation without accidentally making database availability a prerequisite before the approved cutover. |
| PostgreSQL repository | [`backend/src/repositories/postgres-identity-repository.ts`](../../backend/src/repositories/postgres-identity-repository.ts) has identity/token/session CRUD helpers, including create/find/revoke and family revocation. It does not implement a complete refresh rotation, reuse detection, session listing, or a single transaction covering rotation and audit. | Extend repository operations transactionally before use. Existing helper methods are not sufficient evidence that the target lifecycle is implemented. |
| Migration utility | [`backend/src/scripts/migrate-json-identities.ts`](../../backend/src/scripts/migrate-json-identities.ts) is a standalone CLI; it is not imported by the active server. It defaults to dry-run, requires an explicit confirmation for writes, rejects production mode, and accepts only loopback PostgreSQL URLs whose database name contains `test` or `disposable`. [`backend/src/migrations/json-identity-migration.ts`](../../backend/src/migrations/json-identity-migration.ts) currently validates bcrypt-format hashes and preserves them. | The current utility is only for local disposable rehearsal; it cannot target shared staging or production. A future approved operational migration path must be separately reviewed and gated. If Argon2id hashes are introduced before migration, the validator/mapping must be extended first. |
| Tests | `backend/tests` currently contains health, environment, database configuration, PostgreSQL integration, and JSON migration tests; it contains no dedicated active-auth route/JWT/password compatibility suite. | Add focused auth tests before changing runtime behavior. The two database integration cases are not a substitute for API, session lifecycle, or browser/mobile tests. |

### 2.3 Web findings

| Area | Verified current behavior and source | Migration implication |
|---|---|---|
| Auth client | [`nexmeet/src/lib/auth.ts`](../../nexmeet/src/lib/auth.ts): `signUp`, `signIn`, `verifySession`, `signOut`, and `updateProfile` call the existing `/api/auth/*` routes using `fetch`. The API returns a `token`, exposed through the client's `AuthSession.access_token` shape. | Avoid breaking current consumers. Migrate client and server contracts in coordinated, testable stages. |
| Token persistence | The web client stores the bearer token, cached user, and profile override in `localStorage`. Other product code also reads the token directly, including [`nexmeet/src/lib/auraweave.ts`](../../nexmeet/src/lib/auraweave.ts) and [`nexmeet/src/components/AuraWeaveConference.tsx`](../../nexmeet/src/components/AuraWeaveConference.tsx). | Remove long-lived token storage from `localStorage` only after all direct consumers are audited and changed to a shared in-memory access-token provider. Cached non-secret profile data is a separate decision. |
| Session restore and routes | [`nexmeet/src/contexts/AuthContext.tsx`](../../nexmeet/src/contexts/AuthContext.tsx) restores cached state and calls `/api/auth/me`; [`nexmeet/src/components/Protected.tsx`](../../nexmeet/src/components/Protected.tsx) gates the dashboard and meeting routes. On a network error, `verifySession` may return the cached user, so the UI can remain signed in while protected API calls fail. | Distinguish invalid/expired sessions from network outages. Do not erase a valid refresh credential on transient network failure; show an offline/retry state. |
| CORS/deployment | [`backend/src/server.ts`](../../backend/src/server.ts) configures `cors({ origin: true, credentials: true })`. [`nexmeet/src/lib/auth.ts`](../../nexmeet/src/lib/auth.ts) documents a separately hosted Firebase frontend and Render API fallback. | Cookie authentication requires an explicit origin allowlist and deliberate cookie-site design. Current cross-site hosting can require `SameSite=None; Secure` and may be affected by browser third-party-cookie restrictions. Prefer app/API hostnames under a shared site before relying on cross-site cookies. |
| Error handling | Login/signup failures surface API messages in the auth page; session validation signs out on non-OK responses but returns cached user on fetch failure. Profile updates can fall back to locally retained profile data. | Keep errors useful without leaking identity existence or database details. New refresh failures need distinct unauthorized, unavailable, and retryable outcomes. |

### 2.4 Mobile findings

The repository has two Expo-related trees; they are not equivalent:

- **Integrated app:** [`mobile/App.tsx`](../../mobile/App.tsx), entered from [`mobile/index.ts`](../../mobile/index.ts). It implements login/signup against the same `/api/auth/login` and `/api/auth/signup`, stores the access token and cached user with `expo-secure-store`, restores via `/api/auth/me`, and passes the bearer token to the LiveKit-token API. Sign-out deletes local SecureStore values; there is no server revocation call. Any `/me` failure clears the stored token and user, including transient network failures.
- **Scaffold app:** [`mobile/auraclave/src/app/index.tsx`](../../mobile/auraclave/src/app/index.tsx) and `_layout.tsx` show the default Expo starter navigation/screens, not an AuraClave authentication implementation. Do not assume it participates in auth migration.

The integrated mobile app currently persists its 30-day access JWT in SecureStore. The proposed design changes this to a short-lived access token in memory and a rotating refresh token in SecureStore; this requires an explicit app upgrade and reauthentication/refresh transition.

## 3. Target authentication architecture

### 3.1 Proposed target

Keep the existing Express monolith and product APIs. Introduce a small authentication service boundary around password verification, identity persistence, token issuance, and session operations. Keep HTTP route handlers thin and preserve existing user object fields unless an additive API version is approved.

```mermaid
flowchart LR
    Web["Web app<br/>memory access JWT"]
    Mobile["Expo app<br/>memory access JWT"]
    API["Express authentication routes"]
    Auth["Auth service<br/>password + JWT + session policy"]
    Repo["PostgreSQL repositories"]
    Users["users"]
    Families["session families"]
    Tokens["refresh-token records"]
    Audit["auth_audit_events"]
    Mail["Approved email provider<br/>only if reset/verification ships"]

    Web -->|"Bearer access JWT<br/>refresh cookie + CSRF proof"| API
    Mobile -->|"Bearer access JWT<br/>refresh token in SecureStore request"| API
    API --> Auth
    Auth --> Repo
    Repo --> Users
    Repo --> Families
    Repo --> Tokens
    Repo --> Audit
    Auth -. "future reset / verification" .-> Mail
```

**Authority invariant:** in a given deployment mode, the active auth service has one identity authority. Do not perform per-request JSON-to-PostgreSQL fallback, hidden dual-write, or "user not found" fallback between stores; those paths can resurrect deleted accounts or accept stale claims.

## 4. Password migration strategy

### 4.1 Hash selection and verification

**Proposed target:**

1. Treat encoded hash prefixes as an algorithm identifier, then validate the full encoded format and bounded parameters before invoking a verifier:
   - bcrypt: `$2a$`, `$2b$`, and `$2y$` only where compatibility tests prove the chosen library accepts that prefix correctly.
   - Argon2id: `$argon2id$` with supported version/parameters and configured resource bounds.
2. Verify only with the identified algorithm. Do not try algorithms indiscriminately, reinterpret malformed hashes, or fall back to plaintext.
3. Unsupported/malformed hashes fail closed. Return the same generic login failure to the client and emit only a safe operational event keyed by a non-secret identifier; never log the hash or submitted password.
4. Once every active verifier and the migration validator support both formats, write Argon2id hashes for newly created/changed passwords. Until that compatibility gate is met, keep the current JSON bcrypt writer active; do not introduce a hash that another running instance cannot verify.
5. Preserve every legacy hash byte-for-byte during identity import. Do not reset, rehash, or normalize an existing hash as part of bulk migration.
6. After a successful bcrypt verification, upgrade that user's hash to Argon2id by default when the selected identity store can perform a safe compare-and-swap update conditioned on user ID and the exact prior hash. If a safe conditional update is unavailable, allow the verified login but leave the hash unchanged and emit a safe upgrade-failure metric; never treat an upgrade failure as invalid credentials.
7. Never persist plaintext or reversible password material.

The current observed source has one bcrypt `$2b$` cost-10 hash. The current `verifyPassword` function delegates to `bcrypt.compare` from `bcryptjs`; there is no Argon2 dependency or hash dispatcher. M1.2 migration validation currently accepts bcrypt encodings only. If M1.4 introduces Argon2id hashes in JSON mode before data migration, update and test the M1.2 validator before such hashes can be written.

### 4.2 bcrypt compatibility, truncation, and encoding evaluation

A critical security and functional finding across bcrypt implementations is the handling of password inputs relative to the algorithm's fixed 72-byte limit:
1. **The 72-Byte Truncation Boundary:** The core Blowfish cipher underlying bcrypt operates on an expanded key matrix derived from at most 72 bytes of input key material. Implementations differ substantially in how they handle inputs exceeding 72 bytes:
   - Some libraries (including OpenBSD native bcrypt and standard C implementations) silently truncate passwords at the 72nd byte, meaning `password[0..71] + "A"` produces an identical hash to `password[0..71] + "B"`.
   - Other implementations (or wrappers) throw an unhandled exception or reject inputs exceeding 72 bytes.
   - Pure JavaScript implementations (such as `bcryptjs`, currently used in `backend/package.json`) have specific UTF-8 conversion and truncation behaviors that must not be assumed identical to native C/C++ libraries (such as native `bcrypt`) or foreign implementations.
2. **UTF-8 and Multibyte Character Encoding:** Character count is not byte count. Passwords containing multibyte UTF-8 characters (e.g., emojis, accented letters, non-Latin scripts) reach the 72-byte boundary much faster (a 4-byte UTF-8 emoji string of 18 characters is already 72 bytes; 19 characters is 76 bytes). If one library computes byte length on UTF-16 code units while another encodes to UTF-8 before passing to Blowfish, hash outputs or truncation points will mismatch, leading to catastrophic authentication failures during migration.
3. **Selected Argon2id Library Behavior:** When selecting the future Argon2id library (e.g., `@node-rs/argon2` or `argon2`), the verification service must account for the fact that Argon2 has no 72-byte limitation (supporting arbitrarily long passphrases up to $2^{32}-1$ bytes). However, when verifying existing bcrypt hashes or upgrading accounts, the verifier must preserve exact byte equivalence:
   - Never pre-hash or truncate passwords prior to invoking `bcrypt.compare` on legacy hashes, as doing so would invalidate all existing user passwords.
   - For newly created passwords under Argon2id, passwords above 72 bytes must be fully hashed without truncation.
4. **Verification Compatibility During Rolling Deployments:** During rolling blue/green or multi-node deployments where Node.js instances may run different package versions or verification routines, all running instances must evaluate password inputs identically:
   - If Node A runs the legacy `bcryptjs` implementation and Node B runs the new algorithm-aware verifier, both must accept identical password strings below, at, and above 72 bytes, as well as multibyte UTF-8 sequences.
   - An account upgraded to Argon2id on Node B must only be written after confirming that all active nodes (including Node A) possess Argon2id verification capability.

Explicit test matrix requirements covering these boundaries are specified in Section 13 (Unit tests).

### 4.3 Argon2id parameters

**Proposed starting baseline:** Argon2id version 19, memory 19 MiB (`m=19456 KiB`), time cost 2, parallelism 1, using a unique random salt generated by the library. This is a conservative interoperability/security baseline; benchmark on the actual production CPU and memory limits before release. If the measured verification time is materially below the service's latency budget, raise memory/time cost. Do not select parameters by development-laptop speed alone.

Bound accepted hash parameters during verification to prevent attacker-controlled encoded values from causing excessive CPU/memory use after a database compromise. Limit concurrent Argon2 operations with a bounded worker/semaphore and monitor queue time; memory-hard hashing trades brute-force cost for per-request resource pressure. Parameter changes apply to new hashes and successful upgrades; existing bcrypt hashes remain valid until successfully upgraded or changed by the account owner.

**Approval required:** production parameter target, p95/p99 latency budget, and maximum concurrent hash workers.

## 5. Access-token architecture

### 5.1 Proposed access JWT contract

Issue an access token with a 10-15 minute lifetime; use 10 minutes initially unless measured client/network constraints justify 15.

#### Header structure (JOSE Header)
The JOSE header must explicitly identify the signing key and token media type to prevent token-confusion and cross-profile substitution attacks:
- `alg`: Fixed cryptographic algorithm (e.g., `RS256`; reject `none`, symmetric algorithms, or unvetted curves).
- `typ`: Standard media type per RFC 9068. Set to `at+jwt` (or `JWT` during legacy interoperability).
- `kid`: Identifier matching an active public key in the verifier's key set.

#### Payload claims (JWT Claims Set)
The application payload carries authorization, correlation, and temporal bounds. Claims must not conflate JOSE media typing with application semantic purpose:

| Claim | Meaning |
|---|---|
| `sub` | Stable AuraClave user UUID. |
| `iss` | Exact configured AuraClave issuer identifier (e.g., `https://api.auraclave.com` or configured development issuer). |
| `aud` | Explicit API audience (e.g., `https://api.auraclave.com` or `auraclave-api`); reject tokens for other services or clients. |
| `iat`, `exp` | Issued-at and short expiry (e.g., `now` and `now + 15m`); enforce a bounded clock tolerance (maximum 60 seconds). |
| `nbf` | Not-before timestamp; tokens presented prior to `nbf - skew` must be rejected. |
| `jti` | Unique token identifier (UUIDv4) for audit, correlation, and diagnostic tracing; do not log bearer material. |
| `sid` | Stable session-family UUID, used to enforce server-side revocation and session status against PostgreSQL. |
| `token_use` | Explicit application-level claim set strictly to `"access"` for access tokens. Rejects tokens minted for refresh, verification, or reset purposes. |

Do not include password data, refresh tokens, unnecessary profile fields, or long-lived authorization state. Existing `id`, `email`, and `fullName` claims are not a substitute for a validated subject/session contract. Resolve current profile from PostgreSQL when the API requires it.

#### Header `typ` vs. Application Payload Claims
A critical distinction must be maintained between the JOSE header and application payload:
1. **JOSE Header `typ` (`at+jwt` vs. `JWT`):** RFC 9068 Section 2.1 specifies the `typ` header parameter `at+jwt` for JWT access tokens to prevent JWT cross-type substitution attacks (e.g., passing an OpenID Connect ID token or an access token to an unintended endpoint). The JOSE header indicates the *format and media type* of the envelope.
2. **Application Payload Claim (`token_use: access`):** The payload claim `token_use` asserts the *application-level semantic intent* of the token within the AuraClave domain. While `typ: at+jwt` is verified at the JOSE parsing envelope boundary, `token_use: access` is enforced by the application authorization layer. Evaluating both guarantees defense-in-depth:
   - Tokens presented as Bearer tokens to resource endpoints MUST have both `typ` allowed (`at+jwt` or acceptable compatibility profile) and `token_use: "access"`.
   - Opaque refresh tokens are NEVER JWTs; however, in the event any auxiliary utility or third-party token presents a JWT with `token_use: "refresh"`, API access endpoints will immediately reject it.
   - If an intermediate proxy or legacy gateway strips or replaces header fields, the cryptographically signed payload claim `token_use: "access"` remains immutable and tamper-evident.

#### Strict Access-Token vs. Refresh-Token Validation
The architecture establishes an absolute separation between access tokens and refresh tokens:
- **Access tokens** are short-lived, digitally signed JWTs. They are presented in the `Authorization: Bearer <jwt>` HTTP header. Resource servers validate them cryptographically (signature, `iss`, `aud`, `exp`, `nbf`, `token_use: "access"`) and verify the active state of `sid` against the session store or cache.
- **Refresh tokens** are long-lived, opaque, high-entropy random strings (minimum 256 bits). They are NEVER JWTs, contain no visible claims, and are never accepted by API authorization middleware in lieu of an access token. They are transmitted solely to the designated token refresh endpoint (`/api/auth/refresh`) via `HttpOnly` cookie (web) or request body (native mobile) and validated by constant-time hash comparison against PostgreSQL `auth_sessions`.
- Any attempt to use a refresh token as a Bearer access token fails validation immediately due to missing JWT framing. Conversely, presenting an access JWT to `/api/auth/refresh` fails immediately because the refresh service validates against stored token digests, never decoding JWTs as refresh credentials.

#### Backward Compatibility with Existing HS256 JWT Implementation
The existing implementation in `backend/src/auth.ts` issues 30-day tokens signed with `jsonwebtoken` using symmetric HS256 via `JWT_SECRET`, with an unconstrained header and a payload of `{ id, email, fullName }`.
To preserve backward compatibility during the transition period without compromising security:
1. **Dual-profile verification:** The authentication middleware maintains two distinct verification profiles (see Section 10.2):
   - *Legacy HS256 Profile:* Active only while `ENABLE_LEGACY_JWT_COMPATIBILITY=true`. Validates tokens using `JWT_SECRET` and algorithms `["HS256"]`. Does not require `kid`, `iss`, `aud`, `sid`, or `token_use`. Inspects legacy claims (`id`, `email`, `fullName`) and maps `id` to the request user.
   - *Target RS256/Asymmetric Profile:* Requires algorithm `["RS256"]`, validates matching `kid` against the public JWKS/key store, enforces strict `iss`, `aud`, `typ: at+jwt` (or configured compatibility setting), `exp`, `nbf`, and requires `token_use: "access"` and a valid `sid`.
2. **Algorithm Confusion Defense:** The verifier MUST NEVER determine key selection or algorithmic family from the unverified token header alone without strict allowlist validation. Legacy HS256 verification and RS256 verification MUST use isolated verification pipelines with mutually exclusive cryptographic keys: the symmetric `JWT_SECRET` is never passed to asymmetric verifiers, preventing CVE-class algorithm confusion (e.g., using an RSA public key as an HMAC secret).
3. **Phased deprecation:** As detailed in Section 10, legacy HS256 acceptance will be time-bounded, monitored via metrics, and decommissioned completely following the planned cutover reauthentication gate.

### 5.2 Signing and validation

**Proposed target:** RS256 signing with a private key held in a managed secret store/KMS and public verification material available to the API. This avoids distributing signing capability to consumers. Pin the accepted algorithm in verification; require the configured issuer, audience, JOSE header `typ`, `token_use: access`, subject UUID, session ID, and valid `iat`/`exp`/`nbf`. Reject `none`, unexpected algorithms, malformed claims, future-issued tokens outside allowed skew, and expired tokens.

Use a `kid` header to select a key from an explicit allowlist. Rotation procedure:

1. Publish new public key to all verifiers.
2. Begin signing with the new private key and `kid`.
3. Continue verifying the prior public key only for the maximum access-token lifetime plus clock skew.
4. Remove the old verifier key and securely retire the old private key.
5. For compromise, revoke the compromised key immediately, invalidate tokens signed by it, and require affected users to reauthenticate; do not wait for normal expiry.

**Assumptions/approval:** one API currently issues AuraClave JWTs, but downstream JWT consumers beyond this repository must be inventoried. Confirm whether managed asymmetric key support is available in the deployment platform; otherwise approve an alternative with equivalent key isolation and rotation controls.

### 5.3 Revocation limits

Stateless JWTs cannot be recalled by deleting a client token. The proposed `sid` session-family check lets authenticated API middleware reject tokens whose family is revoked or expired; this costs a database lookup or a carefully bounded cache on protected requests. Start without a cache to preserve immediate logout/revocation semantics. If caching is later introduced, document the maximum revocation delay.

If PostgreSQL is unavailable after cutover, fail closed for protected auth operations with a service-unavailable response; do not fall back to JSON or treat a database outage as "not authenticated." Health/meeting operations not requiring auth may remain independent where their current design allows.

## 6. Refresh-token lifecycle and session model

### 6.1 Proposed token lifecycle

- Generate a cryptographically random opaque refresh token with at least 256 bits of entropy; encode as base64url.
- Store only a one-way SHA-256 digest (or a keyed digest with a separately managed pepper if approved) in PostgreSQL. Never store or log the raw token.
- Use a stable `family_id` for a device session. Each rotation creates a new token record linked to the prior record; only one unrevoked, unexpired token may be usable in a family.
- Initial policy proposal: 30-day absolute family lifetime and 7-day inactivity expiry. Each rotated token's expiry is capped by the family absolute expiry. These values require product/security approval.
- On refresh, verify token digest, family/user status, expiry, and revocation. In one transaction, lock the family/current token, revoke the consumed token, insert the successor token record, update last-used state, and record a safe audit event. Return the new access token and refresh credential only after commit.
- On reuse of a consumed/revoked token, revoke the whole family, record a replay event without token value, and require fresh login. Never return the current child token to a replaying client.
- Logout revokes the current family. "Log out all devices" revokes all active families for the user and optionally increments an auth/session version if introduced.
- Password reset/change, account suspension, and suspected compromise revoke all families in the same transaction that changes the credential/status.

```mermaid
sequenceDiagram
    participant C as Client
    participant A as Express API
    participant DB as PostgreSQL
    C->>A: Login with email and password
    A->>DB: Load active user and hash
    A->>A: Verify bcrypt or Argon2id
    A->>DB: Transaction: create family, token digest, audit
    DB-->>A: Commit
    A-->>C: Short-lived access JWT + refresh credential
    C->>A: API request with access JWT
    A->>DB: Validate sid family is active
    DB-->>A: Active family/user status
    A-->>C: Protected response
    C->>A: Refresh using cookie or mobile refresh request
    A->>DB: Lock family/current token; verify digest
    A->>DB: Transaction: consume old token, insert successor
    DB-->>A: Commit
    A-->>C: New access JWT + rotated refresh credential
```

### 6.2 Rotation, races, and reuse detection

**Proposed transaction boundary:** use a transaction-scoped row lock (`SELECT ... FOR UPDATE`) on the session family and current token, then conditionally update the old token only if still active. Insert exactly one successor, set `replaced_by_session_id`, update family activity, and write the audit event in the same transaction. Enforce the one-active-token-per-family invariant with a partial unique index or an equivalent database constraint. If any step fails, roll back all changes.

```mermaid
flowchart TD
    Start["Refresh request"] --> Lookup["Hash presented token; lock family and token"]
    Lookup --> Known{"Token hash known?"}
    Known -- "No" --> Reject["Generic unauthorized response"]
    Known -- "Yes" --> Used{"Already consumed or revoked?"}
    Used -- "Yes" --> RetryCheck{"Legitimate retry within bounded window<br/>and matching Idempotency-Key?"}
    RetryCheck -- "Yes" --> ReturnCached["Re-issue/re-derive cached successor credential"]
    RetryCheck -- "No" --> Replay["Revoke entire family and record replay theft event"]
    Used -- "No" --> Eligible{"Family/user active and token unexpired?"}
    Eligible -- "No" --> Reject
    Eligible -- "Yes" --> Consume["Conditionally mark old token consumed/revoked"]
    Consume --> Success{"Exactly one request consumed it?"}
    Success -- "No" --> Replay
    Success -- "Yes" --> Insert["Insert successor digest and link old to successor"]
    Insert --> Commit{"Transaction commits?"}
    Commit -- "No" --> Rollback["Rollback; return retryable service error"]
    Commit -- "Yes" --> Return["Return new access + refresh credentials"]
```

#### Safe Response-Loss, Retry, and Concurrency Strategy

In real-world mobile and web networks, network failures frequently occur after the server commits token rotation but before the client receives the response ("lost response"). If strict replay detection revokes the family immediately on the client's subsequent retry, legitimate users suffer spurious session invalidation and sudden logouts. Conversely, naive "grace periods" where a consumed refresh token remains valid for multiple uses open a dangerous window for token theft.

To resolve this challenge safely without storing plaintext refresh tokens or introducing unrestricted grace periods:

1. **Client-Side Single-Flight Refresh Coordination:**
   - Both web and mobile auth clients MUST implement a single-flight mutex/concurrency lock around refresh operations.
   - If multiple asynchronous operations (e.g., parallel meeting API calls or multiple browser tabs via BroadcastChannel/SharedWorker) detect an expired access token simultaneously, only *one* network request to `/api/auth/refresh` is dispatched. All other callers await the resolution of that single flight and adopt the newly returned access token.
   - For native mobile, background tasks or navigation events queuing refresh requests must subscribe to a singleton in-flight promise.

2. **Idempotency Identifiers and Bounded Retry Tracking:**
   - When a client initiates a refresh operation, it generates a unique, client-side idempotency identifier (`Idempotency-Key: <UUIDv4>`) that accompanies the request.
   - In the event of a client-side network timeout, connection reset, or abrupt disconnection, the client retries the refresh request with the *same* refresh token and the *exact same* `Idempotency-Key` within a strictly bounded retry window (maximum 15 to 30 seconds).
   - If the server has already committed the rotation transaction, it recognizes the presented token as just consumed, but identifies the matching in-flight/recent `Idempotency-Key` and links to the immediately created successor.

3. **No Raw Refresh Tokens in Plaintext:**
   - Neither the original refresh token nor its successor is ever stored in plaintext in the database, memory caches, or audit tables.
   - The server maintains only one-way cryptographic digests (SHA-256).
   - *Successor Redelivery Mechanism:* To return the successor credential on an idempotent retry without storing raw tokens in plaintext, the server utilizes one of two approved designs:
     - **Ephemeral Encrypted Vault:** When rotating, the newly minted plaintext refresh token is encrypted with an ephemeral in-memory server key (or transient Redis key with a 30-second TTL) keyed by `hash(presented_token + idempotency_key)`. On a verified retry within the 30-second TTL, the server decrypts and re-delivers the successor. The entry is deleted immediately after successful redelivery or expires at 30 seconds.
     - **Deterministic Token Derivation (Alternative):** The successor token is derived using a cryptographic HKDF from the client's high-entropy presentation token and an ephemeral server nonce. This enables deterministic re-computation on legitimate retry without persistence.

4. **Distinguishing Legitimate Retry from Confirmed Token Theft:**
   - **Legitimate Retry:** Characterized by:
     - Presentation of the immediate predecessor token (one generation old).
     - Occurs within a strictly bounded window ($\le 30$ seconds from consumption timestamp).
     - Matches the recorded `Idempotency-Key` and IP/subnet/User-Agent fingerprint bounds.
     - Outcome: Successor response is safely redelivered; the session family remains intact.
   - **Confirmed Token Theft (Replay):** Characterized by:
     - Presentation of an ancestor token older than one generation ($N-2$ or older).
     - Presentation of a consumed token outside the bounded retry window ($> 30$ seconds).
     - Presentation of a consumed token with a different or missing `Idempotency-Key`.
     - Concurrent presentation from conflicting geographies, network ASNs, or disparate user agents.
     - Outcome: Immediate, atomic revocation of the **entire session family** (`revoked_reason: "replay_detected"`), invalidation of all related tokens, safe audit logging without credential disclosure, and fail-closed termination forcing re-authentication.

5. **Remaining Trade-offs and Constraints:**
   - *Transient Storage Complexity:* Storing ephemeral encrypted successors for 30 seconds adds memory/cache state to an otherwise stateless API tier, requiring either sticky sessions or a shared distributed cache (e.g., Redis).
   - *Clock Skew and Latency:* On high-latency mobile networks (2G/3G), a 30-second window may occasionally be exceeded. However, widening the window increases the exposure window for an attacker racing a victim. 30 seconds represents the maximum secure compromise.
   - *Client Obligation:* Clients that fail to implement single-flight locking or fail to persist the `Idempotency-Key` across retries will trigger family revocation. Strict client conformance is mandatory.

**Approval required:** Selection between ephemeral encrypted cache and deterministic derivation for retry redelivery; approval of the 30-second maximum retry boundary.

## 7. Web security design

### 7.1 Proposed browser transport

- Keep the access JWT in memory only; send it in `Authorization: Bearer ...`. Never put a long-lived refresh token or access JWT in `localStorage`, `sessionStorage`, URL parameters, or logs.
- Store the opaque refresh token in an `HttpOnly`, `Secure`, host-only cookie, e.g. `__Host-auraclave_refresh`, with `Path=/`, no `Domain`, and an expiry no later than its server-side family limit.
- Prefer `SameSite=Lax` or `Strict` by serving the app and API under a shared site (for example app/API subdomains). Current Firebase/Render hosting is cross-site; if that topology remains, `SameSite=None; Secure` is required and browser third-party-cookie restrictions may still block it. Validate the chosen production domains in target browsers before adoption.
- Use `credentials: "include"` only for refresh/logout calls that need the cookie. Keep regular API calls on a short-lived in-memory bearer token if that fits the final model.
- For cookie-bearing state changes, require a CSRF proof (synchronizer token or signed double-submit token in a custom header), validate `Origin` against a strict allowlist, and reject unexpected/missing origins for browser requests. SameSite is defense in depth, not the only CSRF control.
- Replace `cors({ origin: true, credentials: true })` with an explicit allowlist for deployed web origins and known development origins. Do not wildcard credentialed CORS.
- Use CSP, strict output encoding, safe rich-content handling, and dependency hygiene. HttpOnly reduces refresh-token theft by JavaScript but XSS can still issue actions using the live page and in-memory access token.
- Local development may use a non-Secure cookie only on loopback HTTP with a development-only configuration; production must fail startup if secure cookie/key settings are absent.

### 7.2 Compatibility behavior

Existing browser code expects a JSON `token`, writes it to `localStorage`, and uses it from several direct `fetch` calls. Do not silently stop returning it while the old client is deployed. Add a versioned or feature-gated contract, transition every consumer to a shared auth client, and remove legacy token persistence only after deployment telemetry proves the old path is unused and rollback behavior is understood.

## 8. Mobile security design

The integrated app already uses Expo SecureStore, but it currently stores the 30-day access JWT. **Proposed target:**

1. Keep short-lived access JWT in application memory only.
2. Store the opaque rotating refresh token in Expo SecureStore; never use AsyncStorage for it.
3. Use a mobile refresh API contract that sends the refresh token in a TLS-protected request body (or another explicitly reviewed transport), separate from the web cookie transport. Do not rely on browser cookies or browser CSRF mechanics in native clients.
4. On launch, obtain a refresh token from SecureStore and request a new access token. Replace the stored refresh token only when rotation succeeds.
5. On explicit invalid/replayed/expired credentials, clear stored credentials and return to login. On network outage, preserve the refresh token, present offline/retry UI, and do not treat a timeout as proof of revocation.
6. On sign-out, request family revocation, then remove local credentials. If offline, clear local credentials immediately only with a documented residual server-token lifetime/mitigation; do not claim remote revocation succeeded.
7. Test SecureStore behavior on supported iOS/Android OS versions, device backup/restore, reinstall, biometric/device-lock configurations, and app background/resume. Do not log request/response token fields.

**Compatibility:** existing SecureStore entries are legacy access JWTs, not refresh tokens. Do not submit them to a refresh endpoint. During migration, invalidate/clear them and require sign-in, or keep the legacy path for a bounded transition window with a specific expiry and telemetry plan.

## 9. PostgreSQL schema assessment

### 9.1 Existing schema summary (verified)

Schema is in [`backend/src/database/schema.ts`](../../backend/src/database/schema.ts), with migrations in [`backend/drizzle/`](../../backend/drizzle/):

- `users`: UUID primary key; email and password hash; full name/avatar; `active`/`suspended`/`deleted` status; optional verification/last-login times; created/updated timestamps; case-insensitive unique index on `lower(email)`; nonblank email/name checks.
- `auth_sessions`: one refresh-token record with user FK (`ON DELETE CASCADE`), stable `family_id`, unique token hash, expiry/revocation fields, self-reference to replacement (`ON DELETE SET NULL`), timestamps and IP/user-agent fields. Indexes cover user, family, expiry; replacement target is unique; expiry must follow creation.
- `email_verification_tokens` and `password_reset_tokens`: user FK cascade, unique token hash, expiry/consumed/created timestamps and user/expiry indexes.
- `auth_audit_events`: nullable user FK (`ON DELETE SET NULL`), event type/outcome, IP/user-agent, bounded JSON object metadata and user/type chronology indexes.
- Typed CRUD exists in `postgres-identity-repository.ts`; it does not yet provide the complete target transactions or policy.

### 9.2 Sufficiency and proposed changes (not applied)

The schema is a useful identity/session foundation but does not by itself guarantee the target lifecycle. No schema or migration changes were made for M1.3.

| Concern | Assessment and proposed design |
|---|---|
| Email canonicalization | Repository writes `trim().toLowerCase()` and queries normalized email; the unique index is only `lower(email)`. Add a database check that persisted emails are canonical (or a stored normalized column with unique index) so whitespace cannot bypass the target uniqueness policy. Preserve the current normalization behavior until a separately reviewed internationalized-email policy is approved. |
| Session-family model | `family_id` and replacement links support a rotation chain, but there is no family-level absolute expiry/revocation/device record and no repository rotation transaction. See Section 9.3 for the detailed comparative schema assessment between extending `auth_sessions` versus introducing a dedicated `auth_session_families` table. |
| Rotation invariant | Add a partial unique index or transaction-enforced equivalent ensuring at most one active refresh token per family. Ensure replaced token and child belong to the same family; the existing self-FK alone does not enforce this. Retain consumed/revoked records long enough for replay detection. |
| Session listing | Add an index/query supporting active families by user and recent activity. Store only a coarse, bounded device label and minimal client metadata. Decide whether IP is necessary; current schema supports `inet` but does not define retention or access policy. |
| Token tables | Existing token-hash uniqueness and consumed fields are sufficient building blocks. Issue/consume/reset operations must use atomic conditional updates and transactions. Add a policy/constraint to invalidate or limit multiple live reset/verification tokens per user if product requirements call for one-active-token behavior. |
| Audit | Existing metadata is bounded to 4 KiB and JSON object; define an allowlisted event schema and retention/deletion policy. Do not place email, token/hash, password, cookie, full request headers, or secrets in metadata. Consider partitioning/archival only if event volume warrants it. |
| Status and verification | Schema has account status and email verification, but legacy JSON has neither and login does not enforce them. Map legacy records to `active`, `email_verified_at = NULL`; do not infer verification. Define how a future verification policy affects signup/login before enforcing it. |
| Transactions | Registration: insert user and audit atomically. Login: verify, conditional hash upgrade, last-login update, family/token creation, and audit atomically where possible. Refresh: lock/consume/insert successor/audit atomically. Reset/change: consume token, replace hash, revoke all families, audit atomically. Logout/revoke: revoke family/session and audit atomically. |
| Retention and deletion | Define expiry cleanup for refresh-token history, consumed reset/verification records, and audit events. User deletion should cascade identity/session/token records while retaining audit rows only under an approved policy (`user_id` becomes `NULL` via `SET NULL`; IP/user-agent or other identifying metadata needs separate redaction/retention rules). Verify legal and product requirements before implementation. |

### 9.3 Session-family schema assessment: extending `auth_sessions` vs. separate `auth_session_families`

A fundamental architectural evaluation for M1.4/M1.6 is how session families are represented in PostgreSQL. Two structural options exist:
- **Approach A (Flat Model):** Extending the existing single `auth_sessions` table with family-level metadata and self-referencing links.
- **Approach B (Normalized Two-Tier Model):** Introducing a dedicated parent `auth_session_families` table with child `auth_refresh_tokens` (or keeping child tokens in `auth_sessions`).

#### Comparative Evaluation Matrix

| Architectural Dimension | Approach A: Extending Existing `auth_sessions` | Approach B: Dedicated `auth_session_families` Parent Table |
|---|---|---|
| **Database Constraints** | Weak constraint enforcement. Enforcing "exactly one active token per family" requires a partial unique index (`WHERE revoked_at IS NULL AND expires_at > now()`). Cross-record integrity (ensuring `replaced_by_session_id` belongs to the same `family_id`) cannot be enforced via standard declarative foreign keys; requires complex trigger functions. | Strong declarative enforcement. The parent table `auth_session_families` has a primary key `id`. A child token table references `family_id` with foreign key `ON DELETE CASCADE`. A partial unique index on the child table cleanly enforces at most one active token per family. |
| **Index Overhead & Size** | Single table accumulates both active tokens and all historic rotated/consumed tokens. Indexes on `(user_id, family_id, created_at)` grow continuously with every token rotation (e.g., every 15 minutes of user activity). Querying active sessions requires scanning through rotation bloat unless aggressively filtered. | Clean separation. `auth_session_families` indexes remain small and proportional to the number of *active physical devices/browsers* (typically 1-5 per user). Historical rotated tokens reside in the child table. Index lookups for user device management are compact and cache-friendly. |
| **Transaction Complexity** | Moderate query complexity. Refresh transactions must lock the row via `SELECT ... FOR UPDATE WHERE id = :current_token_id`, verify family consistency in application code, update the old row, and insert the child row. Family metadata (e.g., device name, initial login IP) must either be duplicated on every rotated row or queried by locating the root token where `id = family_id`. | Streamlined query patterns. The transaction acquires an explicit row lock on the parent family: `SELECT * FROM auth_session_families WHERE id = :family_id FOR UPDATE`. This serializes all refresh requests for that device cleanly. The transaction updates parent `last_active_at`, marks the current child token consumed, and inserts the new child token in one predictable atomic unit. |
| **Family-Wide Revocation** | Inefficient. Revoking a family requires an `UPDATE auth_sessions SET revoked_at = now() WHERE family_id = :family_id`. This updates $N$ historical rows, generating substantial write amplification and dead tuples. | Highly efficient. Revoking a family requires updating a single row: `UPDATE auth_session_families SET revoked_at = now(), revoked_reason = :reason WHERE id = :family_id`. Child tokens are immediately dead because token validation checks parent family status first. |
| **Expiry & Inactivity Management** | Difficult to track dual-lifetimes. Refresh tokens require both an *inactivity lifetime* (e.g., 7 days of non-use) and an *absolute session lifetime* (e.g., 30 days maximum from initial login). In a flat table, either the absolute expiry must be duplicated across all $N$ rotated rows, or the application must trace back to the family root row to determine session age. | Clean dual-lifecycle tracking. The parent `auth_session_families` stores `absolute_expires_at` and `last_active_at`. Individual child tokens store only their short inactivity `expires_at`. The database or middleware evaluates `MIN(parent.absolute_expires_at, child.expires_at)` trivially. |
| **Device Listing & User UI** | Complex aggregation. Rendering "Active Sessions & Devices" in the user settings UI requires complex queries (`SELECT DISTINCT ON (family_id) ... ORDER BY family_id, created_at DESC`) across thousands of rotated rows, making pagination and sorting slow and prone to table bloat. | Simple, direct queries. A trivial query `SELECT * FROM auth_session_families WHERE user_id = :user_id AND revoked_at IS NULL AND absolute_expires_at > now() ORDER BY last_active_at DESC` returns exact device/session cards instantly with negligible I/O. |
| **Replay History & Audit Trace** | Replay detection is viable via self-referencing replacement chains, but querying the chain history requires recursive CTEs (`WITH RECURSIVE session_chain AS ...`), which can degrade database performance under heavy loads. | Child token history is a flat, indexed relationship to `family_id`. Replay detection checks whether the presented hash belongs to the locked family, checks its consumption timestamp, and retrieves the successor in a single index lookup. |

#### Architectural Recommendation and Justification

**Recommendation: Introduce a dedicated `auth_session_families` table (Approach B) in the future PostgreSQL schema evolution.**

**Rationale:**
1. **Device-Level Granularity vs. Token Churn:** In modern authentication, a "session" represents a client device/browser authorization, whereas a "refresh token" is merely a transient, single-use credential rotated frequently. Conflating the two into a single flat `auth_sessions` table forces the database to treat high-velocity credential rotation identically to persistent device tracking.
2. **Elimination of Write Amplification:** A single user active over a 30-day period rotating tokens every 15 minutes generates thousands of token records. When that user logs out or changes their password, revoking their session under Approach A requires scanning and updating thousands of rows. Under Approach B, family revocation touches exactly one row in `auth_session_families`.
3. **Robust Concurrency Control:** Row-locking the parent family record (`SELECT ... FOR UPDATE` on `auth_session_families`) provides an unambiguous, native PostgreSQL serialization point that prevents race conditions and eliminates split-brain child token creation during concurrent refresh requests.
4. **Boundary Note:** In accordance with the M1.3 project boundary, **no database migrations are created or applied in this milestone**. This recommendation governs the schema design to be implemented when session storage work is authorized in future milestones (M1.4/M1.6).

### 9.4 Current account migration representation

M1.2 maps JSON UUID to `users.id`, normalized email to `users.email`, preserves bcrypt hash, name, optional avatar, and creation instant; maps status to `active`, verification/last-login to `NULL`, and `updated_at` to `created_at`. It does not fabricate sessions, reset tokens, or verification tokens. This is consistent with the currently observed JSON shape, but status/verification semantics need product approval before they become enforced authentication policy.

## 10. Backward compatibility and migration strategy

### 10.1 Compatibility invariants

1. Preserve existing UUIDs. These are used as JWT identity and LiveKit participant identity; re-keying accounts would break references.
2. Preserve bcrypt strings exactly at import. Do not reset passwords or assume all hashes have the same bcrypt prefix/cost.
3. Keep the current JSON authority until a separate cutover approval. Do not dual-write JSON and PostgreSQL as a shortcut.
4. Preserve the existing `{ user, token }` API and `user` fields during a compatibility phase or introduce an explicit versioned contract.
5. Do not claim existing 30-day JWTs are refresh sessions. There are no JSON refresh/session records to migrate.
6. Importing user rows does not import or revoke existing JWTs. New JWT validation must be distinguishable from the legacy format.

### 10.2 Existing-token handling, migration boundary, and dual verification profiles

Current access JWTs carry no server-side session ID, are signed with symmetric HS256 using `JWT_SECRET`, and can remain cryptographically valid for up to 30 days. They cannot be transformed into opaque refresh credentials, bound to a device family, or reliably revoked individually.

#### Dual Verification Profiles
To manage the transition cleanly without security regression or abrupt client failure, the authentication service establishes two distinct, mutually isolated verification profiles:

1. **Profile A: Legacy HS256 Verification Profile**
   - **Key Material:** Symmetric `JWT_SECRET` (loaded from environment).
   - **Allowed Algorithms:** Strictly `["HS256"]`.
   - **Validation Rules:** Validates signature and standard `exp`. Does not enforce `kid`, `iss`, `aud`, `sid`, or `token_use`.
   - **Payload Mapping:** Inspects `{ id: string, email: string, fullName?: string }`. Looks up the user in the active identity repository (JSON during legacy phase; read-only fallback prohibited during target phase).
   - **Scope:** Active ONLY when feature flag `ENABLE_LEGACY_JWT_COMPATIBILITY=true`.

2. **Profile B: Modern RS256 / Short-Lived Access Profile**
   - **Key Material:** Managed asymmetric public keys matching `kid` from the internal JWKS key set.
   - **Allowed Algorithms:** Strictly `["RS256"]` (or approved asymmetric suite; reject all symmetric algorithms).
   - **Validation Rules:** Enforces mandatory `iss`, `aud`, `exp` (10-15 min lifetime), `nbf`, clock skew $\le 60$s, JOSE header `typ: "at+jwt"` (or compatibility `JWT`), `token_use: "access"`, and non-empty UUID `sid`.
   - **Session Verification:** Validates that the session family identified by `sid` is active and unrevoked in PostgreSQL.

#### Feature-Flag Behavior and Configuration Gates
The verification boundary is controlled by explicit, typed environment configuration:
- `AUTH_AUTHORITY`: Controls the primary user storage and credential verification (`"json"` by default in M1.3/M1.4; `"postgres"` only after M1.7 cutover).
- `ENABLE_LEGACY_JWT_COMPATIBILITY`: Boolean flag (default `true` during early migration stages; strictly `false` post-cutover sunset).
- `REJECT_LEGACY_JWT_AFTER`: ISO-8601 timestamp establishing an absolute temporal cutoff beyond which legacy HS256 tokens are unconditionally rejected regardless of remaining cryptographic validity.

When both profiles are active during a transition window:
- Middleware inspects the unverified JOSE header `alg`. If `alg === "RS256"` and `kid` is recognized, it dispatches exclusively to Profile B.
- If `alg === "HS256"` and `ENABLE_LEGACY_JWT_COMPATIBILITY=true` and current time is before `REJECT_LEGACY_JWT_AFTER`, it dispatches exclusively to Profile A.
- Any attempt to verify an RS256 token under Profile A, or an HS256 token under Profile B, fails closed immediately. Symmetric keys are never passed into asymmetric verifiers.

#### Deployment Sequencing
The transition from legacy tokens to modern tokens follows a four-phase sequence:
1. **Phase 1: Baseline (Current M1.3/M1.4):**
   - `AUTH_AUTHORITY="json"`, `ENABLE_LEGACY_JWT_COMPATIBILITY=true`.
   - Server issues and verifies legacy HS256 30-day tokens. Modern auth infrastructure is deployed behind feature flags and dormant.
2. **Phase 2: Hybrid Issuance & Dual Verification (Staging/M1.6):**
   - New login/refresh routes issue short-lived access tokens (RS256) and set refresh cookies/credentials.
   - Resource middleware validates incoming tokens against Profile B first; if absent or legacy format, falls back to Profile A.
   - Telemetry tracks the proportion of Profile A vs Profile B requests.
3. **Phase 3: Production Cutover & Bounded Legacy Window (M1.7):**
   - `AUTH_AUTHORITY="postgres"`. All new logins issue Profile B tokens.
   - Pre-existing legacy 30-day tokens are granted a short, bounded grace window (e.g., 24-48 hours, capped by `REJECT_LEGACY_JWT_AFTER`) or cut off immediately via an announced reauthentication event.
4. **Phase 4: Complete Legacy Sunset:**
   - `ENABLE_LEGACY_JWT_COMPATIBILITY=false`.
   - Profile A verification code is permanently disabled. `JWT_SECRET` is rotated or decommissioned for auth token signing.

#### Conditions for Legacy-Token Rejection
Legacy HS256 tokens MUST be rejected immediately under any of the following conditions:
- `ENABLE_LEGACY_JWT_COMPATIBILITY` is set to `false`.
- The current server time exceeds `REJECT_LEGACY_JWT_AFTER`.
- The token payload lacks a valid UUID `id` or email string.
- The user associated with `id` is deleted, suspended, or not found in the authoritative store.
- The token signature is invalid under `JWT_SECRET`.
- The token is presented to endpoints that strictly require a session family (e.g., session management, refresh, device revocation).

#### Existing Session Compatibility & Client Fallback
During the coexistence period, older web clients (storing tokens in `localStorage`) and mobile clients (storing 30-day JWTs in SecureStore) continue to send legacy Bearer tokens. Profile A ensures these clients remain operational until refreshed or prompted to re-authenticate. When an older token expires or is rejected post-cutoff, the client receives HTTP 401 with `code: "SESSION_EXPIRED"`, triggering the existing client-side redirect to the login screen.

#### Regression Testing Requirements
Dedicated automated regression test suites must prove that:
- When modern auth features are disabled (`ENABLE_LEGACY_JWT_COMPATIBILITY=true`, `AUTH_AUTHORITY="json"`), 100% of existing JSON authentication, signup, login, profile updates, and `/api/auth/me` requests behave identically to the baseline repository state.
- Zero PostgreSQL connections or pool allocations are initialized when running in JSON mode.
- Existing client token parsing in `nexmeet/src/lib/auth.ts` and `mobile/App.tsx` continues to function without console warnings or runtime exceptions.

### 10.3 Rollback to JSON

The current JSON file is not automatically synchronized with PostgreSQL after import. A rollback after PostgreSQL writes cannot safely switch the auth flag back to a stale JSON file.

**Required rollback runbook before any production cutover:**

1. Freeze identity mutations and suspend signup/profile/password changes while deciding rollback.
2. Keep PostgreSQL as the temporary source of truth while creating a consistent export of all user records and verifying that IDs, normalized emails, password hashes, profile fields, statuses, and timestamps reconcile.
3. Ensure the JSON-mode verifier can safely read every hash format that may exist (including Argon2id if used); never downgrade/rehash users silently.
4. Restore/reconcile the export into a protected JSON snapshot using a separately reviewed, atomic, non-destructive tool. Preserve the last known-good source snapshot and its access controls.
5. Verify row counts, UUID uniqueness, email uniqueness, password-hash equality, account status treatment, and representative login behavior in an isolated environment.
6. Revoke PostgreSQL refresh families and rotate signing keys/legacy secret as required so rollback does not resurrect old JWTs or leave DB sessions usable. Require fresh login after rollback.
7. Switch authority only after parity is signed off. If export or parity fails, do not switch to stale JSON; keep PostgreSQL auth read-only/degraded or roll forward.

**Important gap:** M1.2 provides a JSON-to-disposable-PostgreSQL rehearsal only. No production migration or PostgreSQL-to-JSON reverse reconciliation tool exists. M1.7 must prove the rollback process with disposable/staging data before cutover approval.

```mermaid
flowchart TD
    Snapshot["Freeze writes and capture protected JSON snapshot"] --> Import["Validate and import to isolated PostgreSQL"]
    Import --> Reconcile["Compare IDs, emails, hashes, profiles, counts"]
    Reconcile --> Shadow["Shadow-read/compare without serving auth from PostgreSQL"]
    Shadow --> Gate{"Approval, recovery drill, and client readiness?"}
    Gate -- "No" --> KeepJSON["Keep JSON authority; fix gaps"]
    Gate -- "Yes" --> Cutover["Scheduled cutover; require reauthentication"]
    Cutover --> Monitor["Monitor login, session, DB, and security signals"]
    Monitor --> Stable{"Continue or rollback?"}
    Stable -- "Continue" --> DBAuth["PostgreSQL remains authority"]
    Stable -- "Rollback" --> Freeze["Freeze auth mutations; do not point at stale JSON"]
    Freeze --> Reverse["Export/reconcile PostgreSQL changes to protected JSON"]
    Reverse --> Verify["Verify parity, hashes, uniqueness, and key rotation"]
    Verify -->|Pass| JSONBack["Switch to JSON; require reauthentication"]
    Verify -->|Fail| Hold["Keep database authority or read-only; roll forward"]
```

## 11. Threat model

| Threat | Attack scenario / impact | Proposed mitigation | Residual risk | Validation |
|---|---|---|---|---|
| Credential stuffing | Reused breached credentials are tried at login; account takeover and service load. | Per-account and per-IP/device adaptive throttles, breached-password checks at password creation/change, generic errors, anomaly monitoring, optional MFA decision. Avoid permanent lockout attackers can weaponize. | Distributed proxies and shared networks weaken IP-only controls; MFA is not currently present. | Load/security tests for thresholds and lockout recovery; synthetic credential-stuffing exercise; verify generic responses. |
| Brute force | Repeated guesses target an account or endpoint. | Rate limits, Argon2id for new/upgraded hashes, bounded hash concurrency, abuse alerts, progressive delays. | Attackers can distribute attempts; stronger hashing raises CPU/memory DoS cost. | Test per-IP/account limits, hash-work queue saturation, and recovery/alert thresholds. |
| Password database compromise | Attacker obtains password hashes and attempts offline cracking. | Argon2id with calibrated memory/time cost and unique salt; preserve legacy bcrypt until successful login upgrade; least-privilege DB and encrypted backups; rapid incident process. | Legacy bcrypt hashes remain weaker until the user signs in; database access may expose profile data too. | Hash-format/parameter tests; backup access review; breach tabletop and rehash-rate dashboard. |
| Refresh-token theft | Malware/XSS/device compromise exfiltrates a live refresh token. | 256-bit opaque token; store only digest in DB; Secure/HttpOnly web cookie; Expo SecureStore mobile; rotation, family revocation, short inactivity/absolute expiry, TLS, no logs. | A stolen unused token can be used once; XSS can still operate the web session. | Verify tokens absent from logs/DB plaintext; theft simulation, family revoke and alert tests. |
| Refresh-token replay | Previously consumed token is presented again. | Atomic one-time rotation, linked token history, family-wide revocation and safe audit event on reuse. | Legitimate concurrent/retried refresh can resemble replay and force reauthentication. | Replay tests, transaction races, lost-response tests, and client single-flight tests. |
| JWT theft | Access JWT copied from browser memory/device/network and replayed. | TLS, 10-15 minute expiry, in-memory web storage, SecureStore refresh only, `sid` check for revocation, restrictive CSP, no bearer logging. | XSS or compromised device can use the current access token until detected; any non-session-aware integration may accept it until expiry. | Theft/revocation tests; verify protected endpoints enforce family status and reject expired tokens. |
| CSRF | Browser is induced to submit cookie-authenticated refresh/logout or other mutation. | SameSite cookie, synchronizer/double-submit CSRF proof, exact Origin validation, strict CORS allowlist, no state changes on GET. | Cross-site hosting and browser privacy changes can affect cookies; XSS bypasses CSRF. | Browser E2E from allowed/disallowed origins; missing/forged CSRF and Origin tests. |
| XSS | Injected script reads localStorage or invokes authenticated actions. | Remove JWT from localStorage, HttpOnly refresh cookie, CSP, output encoding, safe markdown/HTML rendering, dependency review. | XSS can act as the user while the page is open, including obtaining new access tokens through refresh. | CSP tests, targeted stored/reflected XSS regression suite, browser test verifying token absent from web storage. |
| Session fixation | Attacker causes victim to use a known session/token before authentication. | Issue a new random session family only after successful authentication; never adopt client-supplied session IDs; rotate on privilege changes. | Compromised client/browser can still steal post-auth state. | Verify login always creates fresh family and ignores supplied IDs/cookies. |
| Account enumeration | Signup/reset responses or timing reveal registered emails. | Generic signup/reset responses, similar code paths/timing, rate limiting, no email-specific logs in client response. Existing duplicate signup currently reports an explicit duplicate message; address during planned API change. | Email delivery behavior or support workflows can leak status. | Compare response/status/timing for known/unknown addresses; API contract tests. |
| Concurrent refresh race & lost responses | Two client requests rotate the same token, or network drops after server commit; valid client retry may be mistaken for replay theft. | Client single-flight lock; bounded 30s retry window; client-supplied Idempotency-Key; ephemeral encrypted successor cache for redelivery without storing plaintext; immediate family revocation on true theft ($N-2$ replay or $>30$s). | Ephemeral cache state management across multi-instance API deployments; high-latency mobile timeouts exceeding 30s force re-auth. | Parallel refresh integration test; response-loss/retry tests with identical Idempotency-Key; multi-tab single-flight lock tests; simulation of attacker vs victim race. |
| Database outage | Auth reads/writes cannot reach PostgreSQL after cutover. | Explicit readiness/health and pool timeout; fail closed with 503; no JSON fallback; recovery runbook and managed DB HA/backups. | Protected APIs and login are unavailable while DB is unavailable. | Fault-injection tests for connection loss, bounded timeout, no false 401, restore/HA drill. |
| Signing-key compromise | Attacker forges JWTs or obtains signing private key. | KMS/secret manager, least privilege, key IDs, rotation/revocation, private/public separation, alerting and incident key rollover. | Tokens signed before key removal may remain usable unless `kid` is immediately revoked/session checked. | Key rotation and emergency revoke tests; access audit and tabletop. |
| Improper logout/revocation | Client clears local token but server keeps refresh family live, or access JWT remains accepted. | Revoke family on logout; revoke all families on password change/compromise; session-family check for protected APIs; disclose offline logout limitation. | Offline clients cannot prove server revocation; short expiry and family expiry bound the risk. | Logout/revocation API tests, offline mobile behavior test, verify old access JWT rejected after family revocation. |
| Email reset/verification abuse | Guessable/replayed links or enumeration allow account takeover or disclose state. | High-entropy single-use tokens stored hashed, short expiry, rate limits, generic responses, email provider, atomic consume + mutation/revocation. | Email inbox compromise and delivery delays remain. | Token entropy/expiry/replay tests, email-provider sandbox, enumeration and rate-limit tests. |

## 12. Rollout and rollback plan after M1.3

No stage below authorizes production work automatically. Each requires its own reviewed scope and approval. Keep the JSON authority until the explicit cutover gate.

| Stage | Scope and dependencies | DB/API/client changes | Tests and acceptance | Rollback conditions |
|---|---|---|---|---|
| **M1.4 - Auth infrastructure and compatibility** | Implement authentication infrastructure sub-stages (14.1 through 14.5): typed configuration, error taxonomy, algorithm-aware password verifier, Argon2id library integration, modern RS256 JWT engine, dual-profile verification middleware, and transactional session/family repository interfaces. Maintain strict boundary: default production authority remains JSON; no PostgreSQL authentication activation, no production user migration, no cutover, and no changes to existing client authentication behavior or token persistence. | No default production authority switch (`AUTH_AUTHORITY="json"`). Add Argon2id verifier/writer while retaining legacy `bcryptjs`; extend migration validator before writing Argon2id into JSON. Session endpoints and dual-verification features are dormant or feature-gated. Zero DB connection pools initialized in JSON mode. No database schema or migration applied. | Unit tests for bcrypt length boundaries (<72B, =72B, >72B, UTF-8 multibyte), Argon2id, and rolling deployment parity; JWT dual-profile claims/issuer/audience/expiry/key rotation; JSON auth regression; DB pool/outage tests; lint/build. Acceptance: existing endpoints and JSON authority unchanged when feature is off; no secret/token logs. | Disable feature flag and retain prior JSON behavior; no identity migration has occurred. Roll back any dormant changes if tests fail. |
| **M1.5 - Controlled identity migration rehearsal** | Build on M1.2; use a protected, consistent snapshot, staging/disposable PostgreSQL, and a separately approved operator flow. The current M1.2 CLI is loopback-only and is not suitable for remote staging/production. | No production auth traffic. Import IDs/hash/profile data; test shadow reads and reconcile without selecting DB as authority. Any staging-target tool needs explicit environment, confirmation, audit, backup, and transaction gates. | Repeat imports, conflict cases, full hash equality, representative bcrypt login, malformed/duplicate handling, source immutability, transaction rollback, restore from backup, parity report. Acceptance: exact counts and parity; rollback rehearsal passes. | Discard/recreate only the disposable/staging target from baseline; JSON remains authoritative. Never repair by editing live source silently. |
| **M1.6 - Session lifecycle, security hardening, and clients** | Requires M1.4 auth service and M1.5 validated schema/import mapping. Implement lifecycle in a non-production environment first. | Add/complete refresh families, rotate/replay handling, logout/revoke-all, session listing/revocation, password-change invalidation, CSRF/cookie contract, explicit CORS, web in-memory token client, mobile SecureStore refresh flow. Add email routes only after provider and policy approval. | Unit/integration/concurrency tests; browser cookie/CSRF E2E; mobile SecureStore/offline E2E; DB rollback and outage tests; API contract tests against old clients. Acceptance: no old client breaks before migration window; sessions revoke correctly; telemetry has no secrets. | Feature-off returns to current client/runtime contract; revoke test sessions and remove staging data. Do not deploy incompatible cookies or endpoints to production. |
| **M1.7 - Cutover readiness and rollback validation** | Requires accepted prior stages, production DB operational readiness, incident playbooks, backup restore, monitoring, and an explicitly approved maintenance/cutover window. | Final immutable source snapshot, validated production import under separate authorization, authority switch controlled by explicit deployment flag, short legacy-token transition or planned reauthentication, then disable JSON writes. No hidden dual-write. | Full rehearsal with production-like data; throughput/latency/HA tests; forced legacy-token invalidation; session/refresh/replay tests; reverse reconciliation to JSON in isolated recovery drill; user-support and security tabletop. Acceptance: signed parity, restore, rollback, secrets, monitoring, and support readiness. | Freeze writes immediately; keep DB as authority until reverse export/parity succeeds. If it cannot be proven, roll forward or remain read-only - never switch to stale JSON. Revoke sessions and rotate keys as documented. |

### Operational readiness gates

- Managed PostgreSQL HA, encrypted backups/PITR, restore-time objective, connection limits, alert ownership, and incident access tested.
- Secret-store/KMS ownership and emergency rotation documented; no keys in `.env`, source, workflow logs, or diagnostics.
- Dashboards: login success/failure, rate-limit blocks, password-upgrade success/failure, refresh success/replay, active/revoked families, DB latency/errors, cookie/CSRF rejection, and migration parity. Labels must not contain email, tokens, or raw IP unless explicitly approved.
- Redacted structured audit events and a bounded retention/erasure policy.
- Support plan for forced reauthentication, mobile offline state, password reset/email delivery, and account recovery.
- Staging and rollback exercises use synthetic or explicitly protected data and never rely on production traffic as a test.

## 13. Testing strategy

### Unit tests

- **Password & Hash Verification Compatibility Suite:**
  - **72-Byte Boundary Testing:** Explicit verification fixtures testing password inputs strictly below 72 bytes (e.g., 10, 32, 71 bytes), exactly at 72 bytes (72 ASCII characters), and strictly above 72 bytes (e.g., 73, 100, 256 bytes).
  - **Truncation Behavior Assertions:** Do NOT assume all bcrypt implementations handle long inputs identically. Tests must assert and document the precise behavior of the existing `bcryptjs` library: verify whether inputs differing only at/beyond byte 73 match or fail, and ensure new verification code behaves with 100% parity against legacy hashes.
  - **UTF-8 and Multibyte Character Encoding:** Explicit test vectors containing multi-byte UTF-8 sequences (2-byte characters, 3-byte CJK ideographs, and 4-byte SMP emojis). Ensure strings whose character count is < 72 but UTF-8 byte count exceeds 72 bytes are evaluated consistently and without runtime exceptions.
  - **Argon2id Library Behavior & Upgrades:** Test password verification across the selected Argon2id library across all length boundaries without arbitrary truncation. Verify that successful login on a bcrypt hash triggers compare-and-swap upgrade to Argon2id, while an invalid password preserves the bcrypt hash without modification.
  - **Rolling Deployment Parity Matrix:** Run cross-verification assertions where hashes generated by `bcryptjs` are verified by the new algorithm-aware verifier, and hashes produced under the new verifier are verified by legacy routines (for bcrypt prefixes), proving cross-version compatibility during zero-downtime rolling deployments.
- Hash parser rejects malformed, unknown, and excessive-cost encodings; bcrypt `$2b$` compatibility and every additionally supported prefix are tested against known generated fixtures; Argon2id creation/verification and parameter bounds.
- Valid bcrypt login upgrades only after correct password; wrong password never changes a hash; compare-and-swap prevents overwriting a concurrent password change; no hashes/passwords appear in reports/log events.
- JWT accepts only allowlisted algorithm, current key ID, issuer/audience/type, UUID `sub`, active `sid`, and valid temporal claims; rejects wrong issuer/audience, expiry, future `iat`, malformed payload, wrong key, and old token profile.
- Email canonicalization, account status, generic error shapes, reset/verification token hashing/expiry/one-time consumption.

### PostgreSQL integration tests

- Registration plus audit transaction; normalized email uniqueness at DB level; ID preservation and password hash byte equality on import.
- Login success/failure for bcrypt and Argon2id; successful bcrypt upgrade, no update on failure.
- Refresh rotation: one successor, consumed token rejection, family replay revocation, parallel requests, lost response/retry policy, expiry and absolute/inactivity limits.
- Session list, single-family revoke, logout, logout-all, password-change/reset invalidation, suspended/deleted users, and cascade/`SET NULL` behavior.
- Deliberate failure after one valid write proves transaction rollback leaves no partial user/session/audit changes; database pool closes on failure.
- Database outage and recovery: bounded timeouts, fail-closed auth with 503 rather than JSON fallback or false credentials, migrations/restore.

### Web/mobile end-to-end and security tests

- **Legacy JSON Authentication Operational Regression:**
  - Automated tests asserting that with `AUTH_AUTHORITY="json"` and `ENABLE_LEGACY_JWT_COMPATIBILITY=true`, all existing routes (`POST /api/auth/signup`, `POST /api/auth/login`, `PATCH /api/auth/profile`, `GET /api/auth/me`) respond with identical HTTP status codes, response bodies, and headers as the legacy baseline.
  - Regression test proving that in JSON authority mode, no PostgreSQL connection pool is created, and environment configurations lacking `DATABASE_URL` start up successfully without errors.
  - Automated verification that legacy 30-day HS256 tokens issued by earlier runs remain verifiable and grant access to `/api/auth/me` and protected meeting routes until the cutoff date.
  - Test verifying that turning off legacy compatibility (`ENABLE_LEGACY_JWT_COMPATIBILITY=false` or time beyond `REJECT_LEGACY_JWT_AFTER`) cleanly rejects HS256 tokens with HTTP 401 `SESSION_EXPIRED` without server 500 errors.
- Existing signup/login/profile/`/me` and protected meeting flows remain compatible during the feature-off period.
- Browser: token is absent from local/session storage; refresh cookie flags, origin allowlist, CSRF failure/success, expiry/reload, multi-tab single-flight, network loss and session recovery.
- Mobile: SecureStore refresh persistence and rotation; no refresh token in AsyncStorage/logs; app restart, offline retry, invalid/replayed token, logout and reinstall/device edge cases.
- Security regression suite covers stuffing/rate limits, enumeration, CSRF, XSS-sensitive storage, session fixation, refresh replay/races, key rotation/revocation, and auth failure during DB outage.
- Run backend unit/integration suite and frontend build/tests on each milestone; report skipped tests explicitly. No test may silently skip a required DB integration case in CI.

## 14. Open decisions and risks

| Decision/risk | Current evidence | Decision needed before |
|---|---|---|
| Password policy | Signup accepts six characters; no separate policy/strength or breached-password check found. | M1.4: approve minimum/maximum, passphrases, and user communication. |
| Argon2 parameters and concurrency | No Argon2 package/configured workload limit exists. | M1.4: benchmark target hardware, approve latency and concurrency budgets. |
| Signing algorithm/key management | Current JWT uses `JWT_SECRET` and no explicit issuer/audience/key ID. | M1.4: approve asymmetric key provider, issuer/audience identifiers, key owners/rotation and emergency revocation. |
| Cookie domain topology | Web code documents Firebase frontend and Render API; current CORS reflects origins with credentials. | M1.6: choose shared-site domains or accept cross-site cookie limitations; approve exact origins and SameSite policy. |
| Refresh expiry and concurrency | No refresh flow exists. | M1.4/M1.6: approve absolute/inactivity expiry and strict replay versus retry/idempotency behavior. |
| Email verification/reset | No routes, JSON state, or configured delivery provider were found; schema tables are only foundations. | Before adding those flows: product policy, provider, sender/domain, delivery monitoring, and recovery UX. |
| Account statuses | JSON has no status; PostgreSQL has active/suspended/deleted. | M1.5: confirm all imported records start active and decide what unverified means. |
| Existing JWTs | 30-day stateless access tokens have no refresh state or per-device identity. | M1.7: approve forced reauthentication versus a bounded legacy overlap and sign-in communications. |
| Reverse rollback | Only JSON-to-local-disposable-PostgreSQL rehearsal is implemented. | M1.7: build, test, and approve DB-to-JSON reconciliation before any production cutover. |
| Source consistency | Process-local JSON cache, no multi-process locking; read/parse errors initialize an empty in-memory map after logging. | Before snapshot/cutover: define write freeze, source validation, backup, and recovery from malformed source. |
| Session/device metadata | Existing schema can hold IP and user agent but has no retention rules. | M1.4: approve collection, truncation, access, retention, and deletion policy. |
| Downstream token consumers | Repository shows frontend/backend and LiveKit usage; external integrations were not exhaustively audited. | Before changing JWT claims or signing keys: inventory every deployed verifier/consumer. |

## 15. Detailed M1.4 implementation checklist

This is a future checklist, not permission to implement in M1.3.

**M1.4 Scope and Authority Boundary:**
- M1.4 is strictly focused on **authentication infrastructure and backward compatibility**.
- The default production authority MUST remain JSON (`AUTH_AUTHORITY="json"`).
- In M1.4, do **NOT** activate PostgreSQL authentication, do **NOT** migrate production users, do **NOT** introduce a production cutover, and do **NOT** change existing client authentication behavior or token persistence. All new modern authentication components must be dormant or feature-gated.

### Sub-Stage 15.1: Architecture, Configuration & Error Taxonomy
- [ ] Establish typed runtime configuration (`AUTH_AUTHORITY`, `ENABLE_LEGACY_JWT_COMPATIBILITY`, `REJECT_LEGACY_JWT_AFTER`, signing keys, CORS origins, cookie domains).
- [ ] Enforce startup invariants: default `AUTH_AUTHORITY="json"`; ensure `DATABASE_URL` remains optional in JSON mode.
- [ ] Add explicit startup tests asserting that JSON mode initializes zero database connections or connection pools.
- [ ] Define standardized, enumerated error codes and generic client-facing messages (`INVALID_CREDENTIALS`, `SESSION_EXPIRED`, `SERVICE_UNAVAILABLE`) to prevent account enumeration.
- [ ] Complete downstream consumer inventory (Vercel functions, LiveKit room token minting, mobile clients) and document token interface contracts.

### Sub-Stage 15.2: Password Verification & Upgrade Engine
- [ ] Implement an algorithm-aware password verifier dispatching on hash prefix (`$2b$`, `$2a$`, `$2y$`, `$argon2id$`) without fallback to plaintext or unvetted algorithms.
- [ ] Integrate the approved Argon2id library (`@node-rs/argon2` or `argon2`) with verified compatibility on Windows x64 development and Linux x64 CI/production.
- [ ] Implement bounded parameter parsing: enforce time/memory/parallelism thresholds to guard against resource-exhaustion attacks.
- [ ] Execute the password compatibility test matrix:
  - Bounded string lengths: < 72 bytes, = 72 bytes, > 72 bytes.
  - Multi-byte UTF-8 sequences (2-byte, 3-byte CJK, 4-byte emoji) to verify byte-boundary vs code-unit behavior.
  - Legacy `bcryptjs` parity validation against existing hashes.
  - Rolling deployment cross-verification parity tests.
- [ ] Implement safe compare-and-swap hash upgrade logic (upgrades bcrypt to Argon2id only upon successful password verification, conditioned on prior hash match).
- [ ] Extend the M1.2 migration source validator to accept Argon2id hashes before any Argon2id hashes can be written to disk.

### Sub-Stage 15.3: JWT Engine & Dual-Verification Middleware
- [ ] Construct the modern RS256 signing and verification engine:
  - Generate and load asymmetric key pairs with explicit `kid` management.
  - Populate JOSE header parameters: `alg: "RS256"`, `typ: "at+jwt"`, and valid `kid`.
  - Enforce payload claims: `sub` (UUID), `iss`, `aud`, `iat`, `exp` (10-15m), `nbf`, `jti`, `sid` (session-family UUID), and `token_use: "access"`.
  - Enforce clock skew tolerance ($\le 60$ seconds).
- [ ] Construct the dual-profile verification middleware:
  - Route tokens with `alg: "RS256"` strictly to Profile B.
  - Route tokens with `alg: "HS256"` strictly to Profile A when `ENABLE_LEGACY_JWT_COMPATIBILITY=true` and before `REJECT_LEGACY_JWT_AFTER`.
  - Enforce complete cryptographic isolation between symmetric `JWT_SECRET` and asymmetric verifiers.
  - Implement rejection conditions for legacy tokens (flag disabled, expired cutoff, missing claims, deleted user).
- [ ] Add unit tests verifying strict rejection of alg `none`, symmetric-asymmetric key confusion, expired tokens, missing `token_use`, and malformed headers.

### Sub-Stage 15.4: Session & Repository Transaction Foundation
- [ ] Finalize schema evolution design for dedicated `auth_session_families` and child token tables (design only; no migration execution in M1.4).
- [ ] Build transactional repository methods for:
  - Row-locking session family verification (`SELECT ... FOR UPDATE`).
  - Atomic refresh rotation: conditional token consumption, successor hash insertion, activity timestamp update, and audit log creation in one transaction.
  - Family-wide revocation upon replay detection or user sign-out.
- [ ] Implement client-side single-flight lock helper specification and server-side idempotency handler (`Idempotency-Key` tracking and ephemeral encrypted successor cache).
- [ ] Implement database outage handling: return fail-closed HTTP 503 `SERVICE_UNAVAILABLE` without falling back to JSON or generating false credential errors.

### Sub-Stage 15.5: Regression Harness & Verification Suite
- [ ] Run full regression suite proving zero deviation in legacy JSON authentication behavior (`/api/auth/signup`, `/api/auth/login`, `/api/auth/profile`, `/api/auth/me`) when modern flags are disabled.
- [ ] Verify that existing web (`nexmeet`) and mobile (`mobile/App.tsx`) authentication flows function without modification against the JSON authority.
- [ ] Assert that no application source, active database schema, migration SQL, or CI workflows have been inadvertently modified or cut over.

## 16. Review validation and boundary

- Source paths and named functions in this document were checked against the current repository. The mobile app distinction, JSON record structure, bcrypt format/cost, routes, JWT behavior, client storage, and PostgreSQL schema statements are based on inspected code/current local data rather than assumptions.
- Mermaid blocks use standard `flowchart` and `sequenceDiagram` syntax and are internally consistent with the described flows.
- This deliverable adds documentation only. No authentication source, frontend/mobile auth, user JSON, database schema, migration SQL, or CI workflow was changed.
- The five pre-existing modified Nexmeet files remain outside this document and are not to be staged or altered.
- No production migration, database migration execution, commit, or push is part of M1.3.

## Recommended next step

Review and approve the open policy decisions in Section 14 - especially Argon2id resource settings, JWT key custody, refresh replay/concurrency behavior, cookie domains/CSRF, verification/reset policy, and forced reauthentication. Only then begin the separately authorized M1.4 implementation, keeping JSON auth as the default until the later cutover gate.
