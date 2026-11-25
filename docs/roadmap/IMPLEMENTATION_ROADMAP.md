# AuraClave — Implementation Roadmap

## 1. Delivery principles

- Preserve working meeting functionality while hardening foundations.
- Ship small, reviewable, reversible changes.
- No broad rewrite or premature microservices.
- Every milestone has testable exit criteria.
- Security and privacy are release gates, not final-phase polish.
- Translation quality is measured with a reproducible language benchmark.
- Use feature flags for risky capabilities and staged rollout, while retaining the goal of public launch after production readiness.

## 2. Milestone overview

| Milestone | Focus | Primary outcome |
|---|---|---|
| M0 | Audit and design | Approved baseline, architecture, schema, threat model, roadmap |
| M1 | Identity, persistence, authorization | Secure durable foundation |
| M2 | Speech and translation core | Provider-independent streaming pipeline |
| M3 | Multilingual meeting UX | Reliable participant-specific captions |
| M4 | RTC reliability | Robust join/reconnect/device/media behavior |
| M5 | AI intelligence | Grounded summaries, decisions, action items, Q&A |
| M6 | Organizations and workspace | Tenant/team collaboration |
| M7 | Enterprise administration | SSO/MFA, policy, audit, retention controls |
| M8 | Billing and commercialization | Entitlements, metering, payments |
| M9 | Mobile parity | Supported Android/iOS meeting experience |
| M10 | Public launch readiness | Production operations, legal, support, release gates |

## 3. M0 — Architecture and repository audit

### Deliverables
- `CURRENT_STATE_AUDIT.md`
- `TARGET_ARCHITECTURE.md`
- `DATABASE_DESIGN.md`
- `SECURITY_THREAT_MODEL.md`
- `IMPLEMENTATION_ROADMAP.md`
- API route inventory and data-flow diagrams (to be added after full repository verification)
- Architecture decision records

### Tasks
1. Pin default branch and commit SHA.
2. Inventory package/workspace structure and build/test commands.
3. Trace auth and session lifecycle.
4. Inventory persistence paths and data ownership.
5. Trace meeting creation/join/admission and LiveKit token issuance.
6. Trace audio → ASR → translation → captions.
7. Inventory AI provider usage and data access.
8. Inventory recording, consent, retention, export, deletion.
9. Run baseline tests, scans, and build.
10. Approve identity and migration decisions.

### Exit criteria
- All critical flows have file-level references and owners.
- All routes and event types are inventoried.
- Known tests/build status recorded.
- Identity provider decision documented.
- Migration strategy and rollback approved.
- No unresolved ambiguity about who can issue RTC tokens.

## 4. M1 — Identity, persistence, and authorization

### Tasks
- Remove JWT fallback secret; fail startup if required configuration is absent.
- Select and implement one authoritative identity provider.
- Implement account status, email verification, recovery, session refresh/revocation.
- Review browser and mobile credential storage.
- Provision PostgreSQL and migration framework.
- Migrate users and password hashes safely.
- Implement organizations and memberships.
- Persist meetings, participants, guests, join requests, admission decisions.
- Add authorization policy services and tenant scoping.
- Harden LiveKit token endpoint and webhook verification.
- Add audit events for security-sensitive actions.
- Add validation, rate limiting, secure headers, CORS, CSRF where applicable.

### Exit criteria
- No JSON file or in-memory Map is authoritative for identity or admission.
- Restarting API instances does not lose durable meeting/admission state.
- Waiting/pending/rejected participants cannot get RTC tokens.
- Cross-user and cross-tenant negative tests pass.
- Non-host cannot perform host actions.
- Revoked/expired/suspended identities are rejected.
- Migration parity and rollback tests pass.

## 5. M2 — Speech and translation core

### Tasks
- Define `SpeechProvider`, `TranslationProvider`, and provider health contracts.
- Select benchmark corpus covering target Indian and international languages.
- Benchmark candidate providers: Sarvam AI, BHASHINI, Google Cloud Speech, Deepgram, and other viable vendors.
- Measure streaming latency, WER/CER, code-switching, accent robustness, cost, privacy, data residency, quotas.
- Implement audio session lifecycle and VAD/chunking strategy.
- Implement interim/final transcript segment model.
- Implement translation routing grouped by unique target language.
- Add tenant-aware glossary/context.
- Add idempotency, retry, timeout, circuit breaker, and provider fallback policy.
- Define versioned caption event schema and validation.
- Add provider and language-pair metrics.

### Exit criteria
- Provider adapter tests pass.
- Language benchmark results are recorded and reproducible.
- No duplicate final segments under retry/reconnect tests.
- Sequence ordering is preserved.
- Translation is performed once per unique target language per finalized segment, not once per attendee.
- Provider failure is visible and recoverable without ending the meeting.
- Privacy/contract review is complete for selected providers.

## 6. M3 — Multilingual meeting UX

### Tasks
- Participant language preference settings.
- Original, translated, and bilingual caption modes.
- Speaker attribution and stable ordering.
- Interim/final visual distinction.
- Language switching during a meeting.
- Caption history and accessible typography.
- Translation correction/feedback workflow.
- Glossary administration.
- Graceful fallback and degraded-state messaging.
- Keyboard navigation and screen-reader support.

### Exit criteria
- E2E tests cover at least the launch language matrix.
- Participants receive the correct target language.
- Original transcript remains available when translation fails.
- Speaker attribution and ordering pass controlled tests.
- Captions remain usable on supported viewport sizes and mobile clients.
- Caption latency and quality targets are met or explicitly documented by language pair.

## 7. M4 — RTC reliability

### Tasks
- Reconnection state machine.
- Token refresh and reconnect race handling.
- Device selection and device permission UX.
- Mic/camera/screen-share lifecycle.
- Network quality unknown/degraded states.
- LiveKit webhook reconciliation.
- Meeting lifecycle cleanup.
- Participant presence consistency.
- Load and soak tests.

### Exit criteria
- Network interruption/recovery tests pass.
- API/worker restarts do not corrupt meeting membership.
- Device changes work on supported browsers/devices.
- No misleading “good” state when quality is unknown.
- Join success and reconnect metrics are captured.

## 8. M5 — AI intelligence

### Tasks
- Async AI job queue and worker.
- Versioned JSON schemas for summary, topics, decisions, risks, and action items.
- Evidence segment IDs for decisions and tasks.
- Multilingual summaries.
- Human review and correction.
- “Ask this meeting” with authorized retrieval and timestamp/source references.
- Provider adapter around current Groq integration and alternatives.
- Cost/usage tracking and prompt-injection defenses.

### Exit criteria
- AI output passes schema validation.
- Every factual decision/action item is evidence-linked or marked uncertain.
- Unauthorized meeting data cannot be retrieved.
- Provider failure/retry is observable.
- Human correction is retained as a new version/audit event.

## 9. M6 — Organizations and workspace

### Tasks
- Organization onboarding and invitations.
- Teams and membership roles.
- Shared meeting library.
- Notes, tasks, and workspace documents.
- Search with tenant-scoped authorization.
- Calendar/integration foundations.
- Usage dashboard.

### Exit criteria
- Tenant isolation tests pass across all workspace resources.
- Invitations are expiring, hashed, and single-use.
- Membership changes take effect promptly.
- Search results cannot leak cross-tenant data.

## 10. M7 — Enterprise administration

### Tasks
- MFA.
- SSO integration (select protocols/providers based on customer requirements).
- Admin roles and policy controls.
- Audit log viewer/export.
- Retention policy management.
- Data export and deletion controls.
- Session/device management.
- Compliance evidence and security runbooks.

### Exit criteria
- Enterprise admin actions are permission-checked and audited.
- SSO/MFA flows pass security tests.
- Retention and deletion are tested end-to-end.
- Audit logs are protected from unauthorized alteration.

## 11. M8 — Billing and commercialization

### Tasks
- Plans and feature entitlements.
- Server-side usage metering.
- Participant minutes, ASR minutes, translation units, AI tokens, storage, exports.
- Payment provider integration; evaluate Razorpay for India and Stripe/alternatives for eligible international merchant jurisdictions.
- Signed, idempotent webhooks.
- Invoices, tax handling, billing portal, cancellation and grace periods.
- Reconciliation and cost dashboards.

### Exit criteria
- Client cannot alter authoritative usage.
- Duplicate payment events are idempotent.
- Entitlements update only from verified payment/subscription state.
- Usage reconciliation and invoice tests pass.
- Pricing and tax/legal review approved for launch markets.

## 12. M9 — Mobile parity

### Tasks
- Audit current Expo app completeness.
- Secure native credential storage (e.g. platform secure storage).
- Meeting join, audio/video, device permissions.
- Captions and translations.
- Push notifications.
- Reconnection and background/foreground behavior.
- Accessibility and platform QA.

### Exit criteria
- Supported Android/iOS matrix documented.
- Auth and meeting lifecycle E2E tests pass.
- Caption/translation flows meet agreed mobile targets.
- App store privacy declarations and permission prompts reviewed.

## 13. M10 — Public launch readiness

### Product
- Public website, onboarding, pricing, supported language matrix.
- Clear feature availability by plan.
- Help center, support contact, status page.
- Product analytics and feedback loops.

### Operations
- Production/staging separation.
- Backups and restore drill.
- Monitoring, alerting, incident response.
- Load, soak, and failure-injection tests.
- Rollback and disaster recovery procedures.
- Provider capacity and cost limits.
- Runbooks for DB, LiveKit, ASR, translation, AI, and payment incidents.

### Legal and trust
- Terms, privacy notice, cookie notice where applicable.
- DPA/subprocessor list.
- Recording/transcription consent and retention policy.
- Data export/deletion process.
- Qualified review for India and other target jurisdictions.

### Public launch exit criteria
- All P0 security tests pass.
- No unresolved critical/high launch blocker without formal exception.
- Supported language matrix and known limitations published.
- Translation quality and latency measured on representative test data.
- Payment and support workflows tested if billing is enabled at launch.
- Backup restore and rollback demonstrated.
- Monitoring and incident response operational.
- Public-facing legal/privacy materials approved.

## 14. Initial engineering targets (to validate, not guarantees)

| Metric | Initial target |
|---|---:|
| API availability | 99.9% monthly |
| Ordinary API latency | p95 < 300 ms |
| Meeting join success | ≥ 99% under supported conditions |
| Interim caption latency | p95 < 1.5 s |
| Final caption latency | p95 < 3 s |
| Translation after finalized ASR | p95 < 1.5 s |
| Caption event delivery | p95 < 500 ms |
| Controlled-test final event loss | < 0.1% |
| Critical authorization failures | 0 accepted |

Measure end-to-end latency separately from provider latency. Publish per-language-pair quality because one global average can hide poor performance for a specific language.

## 15. Test strategy

- Unit: permissions, admission transitions, translation routing, event validation, billing entitlements, retention.
- Integration: PostgreSQL, Redis, LiveKit token grants, webhooks, provider adapters, job retries, storage.
- E2E: signup, organization invite, meeting, waiting room, multilingual captions, AI summary, export, billing.
- Security: IDOR, tenant escape, stale token, webhook replay, XSS, CSRF, secret scanning.
- Reliability: reconnect, worker restart, provider timeout, queue duplication, DB recovery.
- Load: concurrent joins, audio streams, caption fan-out, translation grouping, transcript writes.
- Multilingual: language pairs, accents, code-switching, background noise, technical vocabulary, numbers/names.

## 16. Ownership and operating cadence

Assign a directly responsible owner for each module and each P0 risk. Review weekly:
- milestone status and exit criteria,
- production defects and security events,
- translation quality/latency by language,
- provider cost and reliability,
- migration parity and rollback readiness.

A milestone is complete only when its exit criteria are demonstrated in CI or documented acceptance evidence—not when code is merely merged.
