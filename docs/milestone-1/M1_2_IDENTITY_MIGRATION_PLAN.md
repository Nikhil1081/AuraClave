# M1.2 — Identity Migration Preparation

## Status and safety boundary

This is a migration rehearsal design and utility, not an authentication cutover. The JSON file remains the active identity source. The utility is a standalone command, is not imported by the API server, never writes to the JSON file, and accepts only a loopback PostgreSQL URL whose database name contains `test` or `disposable`. It also refuses `NODE_ENV=production`.

No production database was contacted. Do not use this utility as a production cutover procedure; that requires separate approval, a production-ready backup/restore runbook, and a reviewed operational change.

## 1. Audited source and current authentication behavior

### JSON record observed

`backend/data/users.json` is a JSON array. During this audit it contained one record with these fields:

| Field | Current source type | Notes |
|---|---|---|
| `id` | string | UUID format in the observed record; used as the JWT identity and LiveKit identity. |
| `email` | string | Required by signup/login; record was already lowercase and had no surrounding whitespace. |
| `passwordHash` | string | Bcrypt-formatted hash; observed prefix was `$2b$` with cost 10. |
| `fullName` | string | Required by the database schema; signup trims it and falls back to the email local part when blank. |
| `avatarUrl` | optional string | Optional in the JSON `UserRecord`; absent from the observed record. |
| `createdAt` | string | ISO timestamp created by signup. |

The migration command recomputes the count and validates each record at run time; the observed count is not assumed to remain current. It rejects malformed records, invalid UUIDs, unsupported hash formats, blank names, invalid emails/timestamps, and unrecognized fields. It does not repair or silently omit records.

### Auth and client behavior audited

- `backend/src/db.ts` loads the JSON array into a process-local map keyed by `email.toLowerCase()`. Lookup normalizes submitted email with `trim().toLowerCase()`; new signup stores the normalized email. Existing source email values are not rewritten when loaded.
- New passwords are hashed with `bcryptjs` using cost 10. `verifyPassword` uses `bcrypt.compare`; legacy bcrypt hashes remain usable because this migration preserves their exact stored strings. The JSON store contains no Argon2 hashes in the audited record.
- Signup (`POST /api/auth/signup`) accepts `email`, `password`, and `name`, then returns `{ user, token }`. Login (`POST /api/auth/login`) accepts email/password and returns the same shape. Profile (`PATCH /api/auth/profile`) updates `fullName`/`avatarUrl` and returns a replacement access token. Current-user lookup is `GET /api/auth/me`.
- JWT access tokens are signed with `JWT_SECRET` and currently last 30 days. There is no server-side refresh-token or session implementation in the active JSON auth flow. Logout is client-side token removal.
- Account status and email verification are not represented in `UserRecord`; login does not enforce either. The JSON flow does not update `lastLoginAt`.
- The web client stores the access token and cached user in `localStorage`; its profile override is also local. The mobile app stores the access token and cached user in Expo SecureStore. Both restore by calling `/api/auth/me`. Neither client currently uses refresh tokens.
- `backend/src/auth.ts` resolves the current identity from the JSON repository when possible and can fall back to JWT claims if the JSON user is absent. This existing behavior is not changed by M1.2.

## 2. Source-to-target mapping

| JSON source | PostgreSQL `users` target | Migration rule |
|---|---|---|
| `id` | `users.id` | Preserve the UUID value and canonicalize hex casing to lowercase, as PostgreSQL does. Invalid or missing IDs block the batch; do not generate replacement IDs because they are referenced by JWTs and LiveKit identity. |
| `email` | `users.email` | Apply the same effective lookup normalization, `trim().toLowerCase()`. Target unique index is case-insensitive; source and target normalized duplicates block the batch. |
| `passwordHash` | `users.password_hash` | Preserve the bcrypt hash byte-for-byte. Accept only the supported bcrypt `$2a$`, `$2b$`, or `$2y$` encoded format. Never log the hash, compare a supplied password, rehash, or reset it. |
| `fullName` | `users.full_name` | Preserve the stored string. Blank/whitespace-only values are invalid because the target requires a nonblank name. |
| `avatarUrl` | `users.avatar_url` | Preserve a supplied string, including an empty string. Missing or `null` maps to SQL `NULL`. |
| Not present | `users.status` | Map to `active`: that is the target default and current JSON login has no suspended/deleted state. |
| Not present | `users.email_verified_at` | Map to `NULL`; the JSON flow has no verification state or enforcement. |
| Not present | `users.last_login_at` | Map to `NULL`; JSON auth does not maintain login timestamps. |
| `createdAt` | `users.created_at` | Require an ISO-8601 timestamp with timezone and preserve the represented instant. |
| Not present | `users.updated_at` | Set to `createdAt` for deterministic import; JSON does not track profile-update time. |
| Not present | sessions/tokens tables | Do not fabricate rows. Existing clients hold long-lived JWT access tokens; there are no JSON refresh tokens, session records, verification tokens, or reset tokens to migrate. |

PostgreSQL normalizes UUID representation when stored, but the UUID identity is preserved. The utility normalizes email on the target rather than preserving inconsistent casing/spacing in legacy records. The database repository also uses `trim().toLowerCase()`. The JSON loader itself only lowercases its map key, so manually edited legacy rows with whitespace or duplicate normalized addresses may not behave identically; such collisions are reported and block writes.

## 3. Validation, conflicts, and transaction rules

1. The source root must be an array. Each record must have only the supported fields (`id`, `email`, `passwordHash`, `fullName`, `avatarUrl`, `createdAt`).
2. The utility records 1-based source positions, includes a source UUID only when it validates, and returns safe Zod issue paths/messages. It does not include raw record values in validation errors.
3. Duplicate source UUIDs and duplicate normalized emails are reported as groups. No “first wins” or “last wins” behavior is allowed.
4. Any malformed source record or duplicate source key blocks the entire apply operation. Valid records in a problematic file are not partially imported.
5. Before writing, the utility checks target rows by UUID and normalized email:
   - Exact mapped identity match is counted as already migrated.
   - A matching ID with different mapped data, or an email owned by another ID, is a target conflict and blocks the batch.
6. Apply inserts all new users in one PostgreSQL transaction. Any constraint failure or other database error rolls back the full transaction. A concurrent import may fail a unique constraint; that entire transaction rolls back and can be safely reviewed/retried.
7. Re-running after a successful import recognizes exact matches as already migrated and inserts zero rows. Changed target identity data is reported as a conflict rather than overwritten.
8. Dry-run performs only target reads. The structured report contains counts, source positions, duplicate/conflict identifiers and failure SQLSTATE when available; it never includes password values, hashes, tokens, database URLs, or raw database messages.

## 4. Commands and environment

Requirements: Node.js 20, backend dependencies installed, an already-migrated **disposable local PostgreSQL database**, and `TEST_DATABASE_URL`. Do not set `TEST_DATABASE_URL` to a managed, shared, or production database. The utility deliberately does not fall back to `DATABASE_URL`.

PowerShell example for a locally provisioned disposable database (replace the placeholder with locally managed test credentials; do not save credentials in the repository):

```powershell
$env:DATABASE_URL = "postgresql://<test-user>:<test-password>@localhost:5432/auraclave_test"
$env:TEST_DATABASE_URL = $env:DATABASE_URL
npm.cmd --prefix backend run db:migrate
```

Default dry-run reads `backend/data/users.json`, connects only to the guarded test target, and writes no rows:

```powershell
npm.cmd --prefix backend run migrate:json-identities
```

To rehearse apply, first make an access-controlled snapshot outside the repository and pass that snapshot explicitly. The source file is opened read-only:

```powershell
$snapshot = Join-Path $env:TEMP "auraclave-users-migration-snapshot.json"
Copy-Item backend\data\users.json $snapshot
npm.cmd --prefix backend run migrate:json-identities -- "--source=$snapshot"
npm.cmd --prefix backend run migrate:json-identities -- "--source=$snapshot" --apply --confirm=I_UNDERSTAND_THIS_WRITES_TO_DISPOSABLE_POSTGRES
```

The apply command requires both `--apply` and the exact confirmation phrase. The URL guard additionally requires loopback (`localhost`, `127.0.0.1`, or `::1`) and a database name containing `test` or `disposable`; `NODE_ENV=production` is refused. These are rehearsal safeguards, not production authorization.

### Example report shape

```json
{
  "mode": "dry-run",
  "status": "ready",
  "sourceTotal": 12,
  "validRecords": 12,
  "malformedRecords": [],
  "duplicateNormalizedEmails": [],
  "duplicateUserIds": [],
  "alreadyMigrated": 0,
  "plannedInserts": 12,
  "inserted": 0,
  "rejected": 0,
  "conflicting": 0,
  "targetConflicts": []
}
```

`rejected` counts unique source records with malformed data or duplicate source keys; `conflicting` counts target conflicts, which include safe field names but never field values. Apply reports `status: "completed"` and the inserted/already-migrated counts. Validation or target conflicts return `blocked`; database/transaction errors return `failed` and an SQLSTATE where available. Non-ready reports exit nonzero. Reports intentionally do not echo user hashes or database details.

## 5. Backup, rollback, and recovery

- Keep the original `backend/data/users.json` unchanged. The utility never writes, renames, truncates, or deletes it.
- Before a rehearsal, pause signup/profile writes long enough to make a consistent source snapshot. Store the snapshot in an access-controlled encrypted location outside the repository; record its size/checksum separately under the operator's secure change record. Do not attach the snapshot or report containing personal data to source control.
- Run dry-run first. Apply only to an empty disposable database after reviewing zero malformed records, zero duplicates, zero target conflicts, and the planned count. Run the same snapshot again to confirm idempotency.
- If validation fails, do not edit the source with the utility or import a subset. Correct the source through the existing owner-controlled process, take a new snapshot, and repeat review.
- If apply fails, the transaction is rolled back; inspect the safe report/SQLSTATE and PostgreSQL logs without copying secrets. Resolve the cause and rerun against the same disposable database.
- For a rehearsal rollback, stop the test process and recreate the disposable database from its baseline migrations. Do not attempt to reverse-delete imported users from the active JSON file.
- For any future production migration, keep JSON authentication serving traffic until a separately approved parity, backup-restore, rollback, and cutover plan exists. A PostgreSQL import alone does not authorize redirecting requests. If production import is later approved, take a recoverable database backup before import and keep the JSON source/backup immutable until reconciliation and rollback sign-off.

## 6. Reconciliation and parity checks

Accept a rehearsal only when:

- `sourceTotal = validRecords`, with no malformed records or duplicate UUID/email groups.
- `inserted + alreadyMigrated = sourceTotal`, with no target conflicts.
- Every source UUID resolves to the same target UUID.
- Normalized email, full name, avatar semantics, status/verification defaults, and creation instant match the mapping above.
- Password hashes compare exactly in memory/database reconciliation, but are never printed or included in reports.
- A second dry-run is read-only and reports every row as already migrated; a second apply inserts zero rows.
- A deliberate target write failure proves transaction rollback leaves none of that batch present.

The tests use synthetic identities only and run through the existing PostgreSQL integration test suite. CI already provisions PostgreSQL 16, sets `CI=true` and `TEST_DATABASE_URL`, applies migrations, and runs all backend tests. The M1.2 migration integration cases are included in `backend/tests/database.integration.test.ts`; they are not conditionally skipped in CI. Do not use the real `users.json` as a CI fixture.

## 7. Verification status

- Backend TypeScript build: passed.
- Migration unit tests: 8 passed.
- Complete local backend suite: 16 passed; 2 PostgreSQL integration tests skipped because no local test URL/service is configured.
- Drizzle migration metadata check: passed.
- TypeScript checks for both migration test files: passed.
- `git diff --check`: passed; `users.json` matched `HEAD` byte-for-byte after validation.
- Safety smoke checks: no-argument invocation selected dry-run; unconfirmed apply, non-loopback dry-run/apply, and `NODE_ENV=production` apply were blocked with structured reports and nonzero exit codes.
- CI guard check with `CI=true` and no `TEST_DATABASE_URL`: failed the PostgreSQL suite at setup, rather than producing a successful skipped result.
- The previous successful M1.1 workflow (45579782159) predates these M1.2 changes. No M1.2 PostgreSQL integration CI run has occurred; do not mark this preparation accepted until the reviewed change set is run against disposable PostgreSQL 16.

## 8. Remaining risks and non-goals

- The audited JSON file had one user; future sources can contain additional fields or historical hash variants. Strict validation blocks such data until an explicit, reviewed mapping is added.
- The database has no legacy status or verification information; mapping all users to active/unverified follows the current implementation but cannot distinguish historical states absent from JSON.
- Existing access JWTs remain valid according to current JSON auth behavior. Importing user rows does not migrate/revoke these tokens or create sessions.
- The source JSON store is process-local cached state with file persistence and no cross-process transaction/locking. A final operational snapshot requires signup/profile writes to be quiesced; this utility does not solve concurrent JSON writes.
- Email validation is intentionally stricter than the legacy endpoint's basic `includes("@")` check. Any legacy address rejected by the migration validator blocks the import for manual review.
- No migration was run against production, and no production authentication or request handling was changed. Do not begin cutover without explicit approval.
