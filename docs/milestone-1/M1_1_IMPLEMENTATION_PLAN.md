# M1.1 Identity and Authentication Implementation Plan

**Branch audited:** `feature/milestone-1-foundation`
**Audit commit:** `a7aba2a24017c17931a13b3235660ae96bde9311`
**Audit date:** 2026-11-25
**Scope:** Identity, authentication, PostgreSQL foundation, and JSON-user migration. No meeting persistence, organizations, RBAC, or billing.

## 1. Repository audit

### Branch and worktree

- Local `HEAD` matched `origin/feature/milestone-1-foundation` at the audit commit, with zero commits ahead or behind.
- Five pre-existing modified files were present and are out of scope. Preserve them without staging, reverting, or editing:
  - `nexmeet/README.md`
  - `nexmeet/src/components/HostAdmissionBanner.tsx`
  - `nexmeet/src/lib/auraweave.ts`
  - `nexmeet/src/lib/auth.ts`
  - `nexmeet/src/pages/Meeting.tsx`
- The modified web auth helper changes `getApiBase()` to use the Render API in production. Keep that behavior when web auth is later migrated.

### Existing identity implementation

- [`backend/src/auth.ts`](../../backend/src/auth.ts) signs 30-day JWTs and reads Bearer tokens. It verifies the signature, looks up the user in the JSON store, but falls back to JWT claims when no stored user is found. M1.1 must remove this fail-open path and verify current account status in PostgreSQL.
- [`backend/src/db.ts`](../../backend/src/db.ts) is a JSON-file repository with an in-memory email-keyed cache. It creates bcrypt hashes with cost 10, normalizes email to lowercase, generates UUIDs, persists `fullName`, optional `avatarUrl`, and ISO `createdAt`, and writes through a temporary file. It has no PostgreSQL/transaction support and is imported by the active auth implementation.
- [`backend/data/users.json`](../../backend/data/users.json) contains records shaped as `{ id, email, passwordHash, fullName, avatarUrl?, createdAt }`. Existing IDs and bcrypt hashes must be preserved. The file remains the migration source and must not be deleted.
- [`backend/src/server.ts`](../../backend/src/server.ts) is the active Express API and current auth route owner. It validates `JWT_SECRET` at startup; M1.1 must preserve startup without `DATABASE_URL` until cutover is explicitly approved.
- `pg`, Drizzle ORM, Drizzle Kit, Zod, and `@types/pg` have been added to the backend for the database foundation. Argon2 has not been added; password behavior remains unchanged.
- `DATABASE_URL` and `TEST_DATABASE_URL` are not configured in this workspace. Docker is unavailable, so local PostgreSQL integration testing cannot currently run.
- [`backend/render.yaml`](../../backend/render.yaml) configures a generated persistent `JWT_SECRET`; it does not provision PostgreSQL or configure `DATABASE_URL`.

### Current API and client contracts

| Route / client flow | Current contract and behavior |
|---|---|
| `POST /api/auth/signup` | Accepts `{ email, password, name }`; returns HTTP 201 with `{ user: { id, email, user_metadata: { full_name, avatar_url } }, token }`. |
| `POST /api/auth/login` | Accepts `{ email, password }`; returns HTTP 200 with the same user/token shape. Password verification currently uses bcrypt only. |
| `GET /api/auth/me` | Requires `Authorization: Bearer <JWT>`; returns `{ user }`. |
| `PATCH /api/auth/profile` | Requires Bearer JWT; accepts `{ fullName, avatarUrl }`; returns `{ user, token }`. |
| Logout / refresh / verification / password reset | No backend routes currently exist. Web and mobile sign-out only clear local credentials. |
| Protected meeting and AI routes | `/api/livekit/token`, `/api/ai`, and room/admission/moderation routes call the backend Bearer-token verifier. Keep their response and authorization behavior compatible while replacing the verifier's user source. |
| Vercel AI function | [`nexmeet/api/_lib/auth.ts`](../../nexmeet/api/_lib/auth.ts) only decodes JWT payload text; it does not verify the signature or consult account state. Align it with the authoritative backend verifier or retire the duplicate verifier as part of the auth cutover. |
| Web | [`nexmeet/src/lib/auth.ts`](../../nexmeet/src/lib/auth.ts) stores access JWT and user profile in localStorage, sends Bearer headers, and exposes `signUp`, `signIn`, `verifySession`, `signOut`, and `updateProfile`. `verifySession` returns cached user data on network failure. [`AuthContext.tsx`](../../nexmeet/src/contexts/AuthContext.tsx) restores this cached state and exposes sign-out/profile methods. There is no refresh-cookie or CSRF flow. |
| Active mobile app | [`mobile/package.json`](../../mobile/package.json) points to [`mobile/index.ts`](../../mobile/index.ts), which registers [`mobile/App.tsx`](../../mobile/App.tsx). It already uses Expo SecureStore for the access token and cached user, calls signup/login/me, and clears both on local sign-out. It has no server logout or refresh flow. |
| Separate mobile scaffold | [`mobile/auraclave/`](../../mobile/auraclave/) is a distinct Expo Router starter with a separate package manifest and no auth flow. Do not treat it as the active app or modify it without a product decision. Both manifests use Expo SDK 58. |
| Supabase | `nexmeet/src/lib/supabase.ts` is a `null` stub; the audited web source has no other Supabase runtime use. Preserve any unrelated Supabase use discovered during implementation. |

### Deployment and integration constraints

- The web client is deployed separately from the Render API. Cookie authentication requires explicit credentialed CORS and CSRF controls. The current Firebase web origin and Render API origin are cross-site; browser third-party-cookie restrictions may prevent a cross-site refresh cookie from working. Validate the production domains and browser policy before enabling cookie sessions; a same-site custom domain or reverse proxy may be required.
- There is no configured email delivery provider in the inspected code or backend dependencies. Token persistence can be implemented independently, but production email verification/password recovery cannot be declared operational until a delivery provider and secrets are configured.
- Database integration tests need an isolated PostgreSQL instance; never point tests or migrations at production. The workflow provisions a disposable PostgreSQL service; the actual run result is recorded below.

### Database-foundation implementation status

- Added Zod-validated PostgreSQL configuration, a lazy `pg.Pool`/Drizzle connection, a connectivity check, and database scripts. The API does not instantiate this connection unless database code is called, so existing JSON-backed authentication continues to start without `DATABASE_URL`.
- Added Drizzle schema and generated migrations for `users`, `auth_sessions`, `email_verification_tokens`, `password_reset_tokens`, and `auth_audit_events`, including `last_login_at`, case-insensitive unique email, token-hash uniqueness, session rotation linkage, foreign keys, checks, and lookup/expiry/audit indexes. The repository stores canonical lowercase email in `users.email`; a second duplicate normalized-email column is intentionally not used.
- Added a typed PostgreSQL identity repository. The active auth routes and JSON repository are unchanged; no production traffic or authentication behavior has been switched.
- The PostgreSQL integration test runs the Drizzle migrator, verifies connectivity, normalized-email uniqueness, user/session/token/audit operations, foreign-key rejection, cascade deletion, and audit `SET NULL` behavior. It is skipped when run locally without a test URL, but it is required in CI: the workflow sets `CI=true` and `TEST_DATABASE_URL`, and the test fails rather than skips if either CI configuration is incomplete.
- CI provisions PostgreSQL 16 and runs `drizzle-kit migrate` before the backend tests. The integration test also invokes the migrator, making its database setup self-contained. Workflow run [45579314717](https://github.com/Nikhil1081/AuraClave/actions/runs/45579314717) on commit `f58087c11b2ceef58fa05cfa5285ebd8e806d1d6` completed successfully: the PostgreSQL service became healthy, migrations applied, the integration test ran (1/1 passed, not skipped), all 9 backend tests passed, backend and frontend builds passed, and TruffleHog secret scanning passed with zero verified secrets.
- The first CI run, [45578925363](https://github.com/Nikhil1081/AuraClave/actions/runs/45578925363), found that Drizzle wraps PostgreSQL constraint errors and the integration test was checking SQLSTATE at the wrong level. The test now asserts `cause.code` for duplicate and foreign-key errors; the succeeding run above verified those checks against PostgreSQL.
- The backend dependency audit reports 9 vulnerabilities (6 moderate, 1 high, 2 critical). The workflow marks this audit `continue-on-error`, so the CI run succeeds; this is a known warning, not a clean audit result. The frontend test step reports there is no frontend test script and skips it as configured.
- Health handler tests now invoke the same production handler functions directly with response mocks, avoiding unnecessary Supertest TCP listeners while retaining explicit HTTP status and response-body assertions. The production endpoints still return HTTP 200 with the same payloads.
- Local verification before CI: backend build passed; complete backend tests passed (8 passed, PostgreSQL integration skipped locally); database configuration tests passed (4); database/health test TypeScript checks passed; `drizzle-kit generate` reported no pending schema changes and `drizzle-kit check` passed. Local PostgreSQL was unavailable, so live DB verification was completed by the disposable CI service instead.
- **PostgreSQL foundation verification gate: passed** by the successful CI run above. This does not implement or authorize authentication migration or production cutover; the JSON identity store remains active and subsequent M1.1 phases remain separate.

## 2. Implementation sequence

### Phase 1 — Plan and contract freeze

1. Keep this audit and plan current as implementation reveals details.
2. Preserve the existing signup/login/me/profile response shapes where practical; add logout, refresh, verification, and recovery endpoints without breaking current screens.
3. Use PostgreSQL as the future identity source, but keep the JSON implementation active until migration parity and rollback checks pass.
4. Do not change the five pre-existing `nexmeet` edits listed above.

**Exit:** audited contracts are recorded; no auth behavior is switched.

### Phase 2 — PostgreSQL database foundation (first implementation phase)

1. [x] Add `pg`, Drizzle ORM, Drizzle Kit, Zod, and compatible TypeScript typings as backend dependencies. Do not add a credential to source or commit a real `.env`.
2. [x] Add Zod-validated database configuration and lazy `pg.Pool`/Drizzle connection management. A missing `DATABASE_URL` must not break the existing JSON-backed API during this foundation phase. Close the pool cleanly in scripts/tests.
3. [x] Define identity-only Drizzle schema:
   - `users`: preserved UUID/email/profile/password hash, account status, verification and last-login timestamps, and UTC created/updated timestamps; canonical lowercase email with a case-insensitive unique index.
   - `auth_sessions`: user FK, refresh-token hash (never raw token), token-family identifier, expiry/revocation/last-use timestamps, rotation linkage, and client metadata needed for session management.
   - `email_verification_tokens` and `password_reset_tokens`: user FK, unique token hash, expiry, consumption timestamp, and creation timestamp.
   - `auth_audit_events`: nullable user FK, event type/outcome, bounded metadata, request metadata, and creation timestamp.
4. [x] Use PostgreSQL UUIDs, foreign keys, unique/check constraints, and indexes for email lookup, user/session lookup, token hashes, token expiry, and audit chronology.
5. [x] Add Drizzle Kit configuration, generated migrations, migration scripts, and a typed repository layer. Keep the existing JSON module and API imports unchanged for now; name/document the PostgreSQL repository distinctly so there is one new SQL implementation rather than an accidental replacement or hidden dual-write.
6. [x] Add a database connectivity check and tests for configuration/repository behavior. Configure a disposable PostgreSQL CI service for required integration tests. Do not provision production resources from this workspace.

**Exit:** schema and migration generate cleanly; PostgreSQL integration test passes against disposable PostgreSQL 16; backend build and all backend tests pass; frontend build passes; the running auth API still uses JSON. **Verified** by workflow run 45579314717. The local integration test remains skipped solely because no local DB service is configured.

### Phase 3 — Idempotent JSON migration utility

1. Parse the existing JSON shape using Zod without logging password hashes.
2. Provide dry-run by default, explicit apply mode, duplicate detection by UUID and normalized email, and a concise migration report.
3. Insert all rows in a transaction, preserve IDs/profile/hash/timestamps, and make retries safe.
4. Validate row counts, uniqueness, preserved bcrypt hashes, and representative legacy password verification. Retain the source JSON unchanged.
5. Do not redirect production traffic until parity, backup, rollback, and operator approval checks pass.

**Exit:** repeatable dry-run/apply and rollback evidence against a disposable PostgreSQL database; migration parity report accepted.

### Phase 4 — Authentication services and API compatibility

1. Add Argon2id hashing for new passwords. Detect and verify legacy bcrypt hashes; rehash a legacy password to Argon2id only after successful login.
2. Add short-lived access JWTs and random opaque refresh tokens; store only hashes. Rotate refresh tokens transactionally and revoke the token family on detected reuse.
3. Implement login/register/logout/refresh, current-user lookup, session revocation, email verification, password recovery, profile update, and audit events. Require an active PostgreSQL account for every authenticated request; missing/suspended/deleted users fail closed.
4. Preserve current user JSON fields and response contracts while defining stable machine-readable errors and adding the new refresh/logout/token routes.
5. Update all backend protected-route consumers and the Vercel AI verifier so no service trusts decoded, unsigned claims.
6. Configure reset/verification delivery through an approved email provider; never expose raw tokens outside the delivery mechanism.

**Exit:** authentication/security tests cover hash compatibility, account status, rotation/reuse, revocation, recovery, verification, and database failures.

### Phase 5 — Web integration

1. Preserve current auth screens and profile/dashboard UX.
2. Keep access JWTs in memory rather than localStorage; use an HttpOnly, Secure refresh cookie with appropriate SameSite/domain settings.
3. Add CSRF protection for cookie-authenticated mutations, explicit allowed origins, credentialed CORS, and session restoration/refresh.
4. Ensure offline/cached profile data is display-only and never authorizes a request.
5. Validate cookie behavior on supported production domains/browsers before removing the old localStorage bearer flow.

**Exit:** browser tests cover signup/login, restoration, refresh, CSRF rejection, logout, and expiry.

### Phase 6 — Mobile integration

1. Integrate with the active `mobile/App.tsx` app, preserving navigation and LiveKit behavior.
2. Store opaque refresh credentials in Expo SecureStore; keep access JWTs in memory and restore/refresh through the API.
3. Implement signup/login/session restore/logout and server revocation without persisting refresh tokens in AsyncStorage or localStorage.
4. Follow the Expo SDK 58 versioned docs and use Expo-compatible dependency installation.

**Exit:** Android/iOS-auth flow tests cover registration, restoration, refresh, logout, and expired/revoked sessions.

### Phase 7 — Cutover and acceptance

1. Run backend/web/mobile builds and all existing/new tests.
2. Verify migration counts and preserved IDs/hashes against the JSON source.
3. Run auth negative tests, PostgreSQL failure tests, and existing LiveKit/meeting regression tests.
4. Enable PostgreSQL-backed auth only after the migration validation gate is accepted; retain a documented rollback path.
5. Update the baseline/roadmap with actual outcomes. Do not start organizations/RBAC, billing, meeting persistence, or other excluded work.

## 3. M1.1 acceptance gates

- No production database credential is committed.
- Database schema/migrations are reproducible and run only against configured targets.
- JSON migration is dry-run capable, idempotent, transactional, reportable, and leaves the source file intact.
- Existing bcrypt users can log in; new passwords use Argon2id.
- Refresh tokens are opaque, stored hashed, rotated, and reuse-detected.
- All protected backend and serverless routes verify signed credentials and current account status.
- Web refresh credentials are HttpOnly cookies with CSRF/CORS controls; no refresh token is stored in localStorage.
- Mobile refresh credentials use SecureStore.
- Missing/suspended/deleted users and database failures fail closed.
- Existing meeting, LiveKit, waiting-room, caption, AI, and mobile navigation flows remain compatible.
- Production cutover is gated on successful migration parity and rollback verification.

## 4. Current blockers and non-goals

- **Local PostgreSQL integration tests:** unavailable because neither `DATABASE_URL`/`TEST_DATABASE_URL`, a PostgreSQL executable/service, nor Docker is configured. The required integration test passed on disposable PostgreSQL 16 in CI run 45579314717. Do not substitute production credentials.
- **Managed database provisioning:** no provider/resource or connection secret is configured in this workspace. The foundation can be implemented without it; deployment/cutover cannot.
- **Email delivery:** no provider is present. Production verification and recovery delivery require a configured provider before those flows can be accepted.
- **Web cookie deployment:** Firebase and Render are currently separate origins; cross-site cookie support must be confirmed or deployment domains adjusted before web cutover.
- **Excluded:** organizations, RBAC, billing, meeting persistence, and production deployment.
