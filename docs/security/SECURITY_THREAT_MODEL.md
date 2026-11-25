# AuraClave — Security Threat Model

## 1. Scope and assumptions

This threat model covers the web/mobile clients, API, identity, organizations, meetings, LiveKit token issuance, speech/translation providers, AI workers, recordings, billing, and operational infrastructure.

AuraClave is a multi-tenant collaboration product. Meeting audio, transcripts, translations, recordings, participant identity, organization data, and billing records are sensitive assets.

The controls below are **requirements**, not claims of current implementation.

## 2. Assets to protect

1. Account credentials, sessions, recovery tokens, MFA secrets.
2. Organization membership, roles, invitations, and tenant configuration.
3. Meeting metadata, access links, participant lists, admission state.
4. LiveKit access tokens and media permissions.
5. Live audio/video and screen-share streams.
6. Original transcripts, translations, captions, recordings.
7. AI summaries, decisions, action items, and meeting Q&A.
8. Billing, payment events, usage, invoices.
9. Provider API keys, database credentials, signing keys.
10. Audit logs, consent records, deletion and retention evidence.

## 3. Trust boundaries

- Browser/mobile client ↔ AuraClave API.
- AuraClave API ↔ PostgreSQL/Redis/object storage.
- AuraClave API ↔ LiveKit.
- LiveKit ↔ speech ingestion/worker.
- Workers ↔ external ASR/translation/LLM providers.
- Payment provider ↔ webhook endpoint.
- Organization tenant ↔ other tenants.
- Guest participant ↔ authenticated member.
- Production operator ↔ deployment and secret management.

Every boundary requires authentication, authorization, validation, and observability appropriate to the data crossing it.

## 4. Threats and mitigations

| ID | Threat | Impact | Required controls | Priority |
|---|---|---|---|---|
| T-01 | Hardcoded/default JWT signing secret | Account impersonation | Remove fallback; managed secret; startup fail-closed; rotate keys | P0 |
| T-02 | Stolen browser token via XSS | Account takeover | XSS prevention, CSP, safe rendering, short sessions, refresh rotation, revocation; evaluate secure cookie vs platform storage | P0 |
| T-03 | Cached profile treated as authenticated | Unauthorized UI/actions | Cache is display-only; server verifies session and account status on every protected request | P0 |
| T-04 | Auth provider split-brain | Inconsistent identity/authorization | One authoritative identity; documented migration and token validation | P0 |
| T-05 | User guesses meeting ID/room name | Unauthorized meeting access | Opaque IDs are not authorization; membership/guest/admission checks on server | P0 |
| T-06 | Waiting-room bypass | Unauthorized audio/transcript access | Durable admission state; pending/rejected users receive no RTC token; negative tests | P0 |
| T-07 | Client spoofs host role | Meeting takeover | Server-derived role; policy checks for every host action | P0 |
| T-08 | Cross-tenant object access (IDOR) | Data breach | Tenant-scoped queries, ownership checks, RLS defense-in-depth, cross-tenant tests | P0 |
| T-09 | Forged/replayed LiveKit webhook | False participant state | Signature verification, timestamp/replay checks, idempotent event handling | P0 |
| T-10 | Malicious caption/data message | XSS, event spoofing, resource exhaustion | Schema validation, text rendering, payload limits, sender binding, rate limits | P0 |
| T-11 | Transcript/recording exposed by public URL | Confidentiality breach | Private storage, short-lived signed URLs, authorization at issuance, audit | P0 |
| T-12 | Recording/transcription without valid consent | Privacy/legal risk | Clear indicators, per-policy consent, revocation handling, retention controls | P0 |
| T-13 | Prompt injection inside transcript | AI data exfiltration or unsafe actions | Treat transcript as untrusted data; isolate instructions; no tool authority from transcript; output validation | P1 |
| T-14 | AI invents decisions/owners/deadlines | Business harm | Evidence segment references, null/uncertain fields, human review | P1 |
| T-15 | Provider outage or quota exhaustion | Caption/AI failure | Timeouts, circuit breakers, bounded retries, fallback/degraded UX, provider monitoring | P1 |
| T-16 | Payment webhook replay/forgery | Incorrect billing | Signature verification, event ID uniqueness, idempotency, reconciliation | P0 |
| T-17 | Secret leakage in logs/build artifacts | Provider/account compromise | Secret scanning, redaction, server-side secrets, rotation runbooks | P0 |
| T-18 | Abuse of signup/join/translation endpoints | Cost/availability abuse | IP/account/tenant limits, quotas, abuse detection, CAPTCHA/risk controls where appropriate | P1 |
| T-19 | Data survives deletion request | Privacy non-compliance | Deletion orchestration across DB, object storage, caches, exports, derived indexes | P0 |
| T-20 | Dependency/supply-chain compromise | Code execution/data breach | Lockfiles, dependency scanning, signed builds, least-privilege CI, review | P1 |

## 5. Authentication and authorization requirements

- Remove hardcoded fallback secrets immediately.
- Required secrets must be present and valid before the API starts.
- Choose one authoritative identity provider and document web/mobile session flows.
- Enforce expiry, refresh rotation, revocation, account status, and suspicious-session controls.
- Do not use localStorage-cached profile data as authorization evidence.
- Check permissions on the server for every protected operation.
- Enforce tenant membership and resource ownership on every query.
- Keep access tokens short-lived and scoped to the minimum required LiveKit grants.
- Pending/rejected/expired admission states must not receive a media token.
- Host/moderator permissions must be server-derived and checked on each action.

## 6. LiveKit and media security

- API token issuance must validate authenticated user, meeting existence, tenant membership or guest authorization, meeting lifecycle, admission decision, and role.
- Token grants must be minimal: correct room, identity, publish/subscribe/data permissions.
- Use short TTLs appropriate to join/reconnect flows.
- Validate LiveKit webhooks with the provider's signature mechanism and protect against replay.
- Do not confuse SFU transport encryption with true end-to-end media encryption.
- If E2EE is claimed, design, implement, and independently test key distribution, device lifecycle, recording compatibility, and recovery before making that claim.
- Recording/transcription must be visibly indicated and governed by policy and consent.

## 7. AI and provider security

- Provider keys stay server-side in a secret manager.
- Workers fetch only the minimum meeting data needed.
- Transcripts and user content are untrusted input, not system instructions.
- AI outputs are schema-validated and bounded.
- No external tool execution based solely on transcript content.
- Store provider/model/version and evidence references.
- Apply tenant-level usage limits and provider cost ceilings.
- Define provider retention/training terms and data residency before selecting a production provider.

## 8. Privacy, consent, retention

- Separate consent concepts for recording, transcription, and AI processing where required.
- Show clear indicators while capture/processing is active.
- Record consent state and policy version.
- Provide tenant retention controls within legal and operational limits.
- Support export and deletion workflows.
- Deletion must include derived artifacts and object storage.
- Do not collect/store audio or transcript content unless required by an enabled feature and disclosed policy.
- Publish privacy notice, terms, DPA/subprocessor list, and incident contact before public launch; obtain qualified legal review for target jurisdictions.

## 9. Security engineering controls

### Build and code
- TypeScript strict mode where practical.
- Runtime validation for all external inputs.
- Parameterized SQL/ORM-safe queries.
- Secure headers and restrictive CORS.
- CSRF protection for cookie-authenticated state-changing requests.
- Output encoding and safe Markdown rendering.
- Rate limiting and abuse controls.
- Dependency, container, secret, and static analysis scanning.
- Protected branches and required CI checks.

### Operations
- Separate dev/staging/production credentials.
- Least-privilege service accounts.
- Managed secret store and rotation.
- Encrypted backups with restore drills.
- Centralized redacted logs, metrics, traces, alerting.
- Incident response and breach notification playbooks.
- Documented rollback and disaster recovery.

## 10. Launch-blocking security tests

The following must pass before public launch:

1. User A cannot read User B's private meeting.
2. Organization A cannot read or mutate Organization B resources.
3. A pending waiting-room participant cannot obtain an RTC token.
4. A rejected participant cannot reconnect using stale client state.
5. A non-host cannot perform host-only actions by changing client payloads.
6. A suspended/deleted user cannot obtain a new token.
7. Expired/revoked credentials cannot access protected endpoints.
8. Forged or replayed LiveKit webhooks are rejected or safely deduplicated.
9. Forged/replayed payment events do not change entitlements twice.
10. Unauthorized users cannot access transcripts, recordings, exports, or AI results.
11. Oversized/malformed data messages are rejected.
12. Stored transcript text cannot execute script in the UI.
13. Deletion workflow removes covered data from primary and derived stores.
14. Secrets are absent from repository history, client bundles, logs, and artifacts.

## 11. Security release gates

- **Gate A — Internal development:** no known critical auth bypass; secrets externalized; protected routes verified.
- **Gate B — External pilot:** durable admission, tenant isolation, recording/transcription consent, audit trail, incident contact, tested backups.
- **Gate C — Public launch:** all P0 tests pass, dependency/secret scans clean or accepted with documented exception, privacy/legal materials approved, monitoring and response runbooks operational.

Any exception must have owner, rationale, compensating control, expiry date, and explicit approval.
