# AuraClave — Current-State Repository Audit

**Audit type:** Preliminary engineering audit  
**Repository:** `Nikhil1081/AuraClave`  
**Default branch & baseline commit:** `main` (`9194c55c0de145930b2252afad75ad4e837ebc86`)  
**Audit status:** Baseline verified against `main`; P0 hardening in progress.

## 1. Executive summary

AuraClave already has the foundations of a browser-based meeting product: a React/Vite client, Node/Express backend, LiveKit-based real-time media, AI meeting-note capability, browser speech recognition support, and an Expo/React Native mobile area.

The main architectural concern is not the choice of frontend or SFU. It is the gap between a prototype-oriented implementation and the requirements of a multi-tenant public SaaS product. The highest-risk areas identified so far are:

1. Authentication and session trust.
2. JSON-file and in-memory state used for authoritative identity and meeting admission.
3. Server-side authorization for LiveKit token issuance and host-only actions.
4. Production-grade multilingual speech/translation orchestration and event contracts.
5. Reliability, observability, privacy, and operational controls.

**Recommendation:** Do not begin by rewriting the UI or splitting the backend into microservices. First establish persistent identity, tenant boundaries, durable meeting/admission state, and server-enforced authorization. Then build the translation pipeline behind provider interfaces.

## 2. Known repository shape

The following structure and technologies have been identified from the available repository inspection notes. Reconfirm before implementation.

| Area | Known baseline |
|---|---|
| Web client | React 19, Vite 7 |
| API | Node.js, Express, TypeScript |
| Real-time media | LiveKit SFU |
| AI notes | Groq integration |
| Browser speech | Web Speech API, with support described for 11 Indian languages |
| Recording | Browser MediaRecorder/local recording |
| Auth integration | Supabase frontend integration alongside custom backend auth |
| Persistence | JSON file-backed user store in `backend/data/users.json`; in-memory cache |
| Room state | In-memory `Map` in `backend/src/roomManager.ts` |
| Deployment references | Firebase Hosting and Render |
| Mobile | `mobile/` Expo / React Native project |

## 3. Findings and risk assessment

### 3.1 Identity and sessions — Critical

**Observed in `backend/src/auth.ts`:**
- A hardcoded fallback JWT secret exists: `auraclave-production-super-secret-key-2026`.
- JWT expiry is configured for 30 days.
- Authentication can fall back to identity claims in a valid token when the user is absent from the JSON-backed user store.

**Observed in `nexmeet/src/lib/auth.ts` and `nexmeet/src/contexts/AuthContext.tsx`:**
- The web client stores an auth token and user profile in `localStorage`.
- A cached profile may be retained when session verification fails.

**Risk:**
- A fallback secret can make production deployments predictable if environment configuration is missing.
- Long-lived bearer tokens increase the impact window of token theft.
- Treating cached identity as authenticated can cause incorrect UI and potentially unsafe access decisions if server checks are weak.
- Supabase and custom auth create ambiguity over the authoritative identity source.

**Required action:**
- Remove the fallback secret and fail closed at startup if required secrets are absent.
- Select one authoritative identity system.
- Implement explicit session lifecycle, refresh, revocation, expiry, and account status checks.
- Cached profile data may support display/offline UX only; it must never establish authorization.
- Review web and mobile token storage separately. Use secure, platform-appropriate sessions; do not blindly apply a browser cookie design to native clients.

### 3.2 Persistence and horizontal scaling — Critical

**Observed in `backend/src/db.ts`:**
- JSON file persistence and an in-memory Map are used for users.

**Observed in `backend/src/roomManager.ts`:**
- Room state is held in an in-memory Map.

**Risk:**
- Multiple API instances will not share authoritative state.
- Restarts can erase or desynchronize room/admission state.
- File writes introduce concurrency, corruption, backup, and deployment-volume concerns.
- Admission and membership cannot safely be enforced from ephemeral state.

**Required action:**
- Move authoritative user, organization, meeting, participant, and admission state to PostgreSQL.
- Use Redis only for ephemeral coordination, cache, presence, rate limits, and job infrastructure.
- Treat PostgreSQL as the durable source of truth.

### 3.3 Meeting admission and room authorization — Critical

**Observed in `backend/src/roomManager.ts`:**
- Room creation can occur on demand, with the first user becoming host.
- Defaults include `openToAll: true` and waiting room disabled.
- Join requests may auto-admit when open access is enabled or waiting room is disabled.
- `checkAdmission` can return admitted for a room that does not exist.
- Admission decisions are held in memory and rely on a host identifier.

**Risk:**
- Missing or stale room state can result in unintended admission.
- A room name must not be sufficient authority to join.
- Host identity and role must be checked on the server, not trusted from client state.

**Required action:**
- Use a durable meeting lifecycle and explicit admission state machine.
- Default private meetings to deny-by-default.
- Validate membership, guest invitation, meeting status, admission decision, and role before issuing RTC credentials.
- Make host/moderator operations server-authorized and auditable.

### 3.4 Real-time media and event handling — High

**Known from the LiveKit integration notes:**
- The web client connects using LiveKit Room with adaptive stream and dynacast.
- It requests a token from `/api/livekit/token`.
- Client-side token refresh/reconnect logic exists.
- Chat, captions, reactions, and hand events use LiveKit data messages.
- Caption events currently use a minimal shape similar to `{ type: "caption", speaker, text }`.
- `isHost` is passed into client-side logic.
- Some stage-management actions are no-ops.
- Unknown network quality may be mapped to “good”.

**Risks:**
- Minimal event contracts lack durable IDs, ordering, language metadata, and validation.
- Client-side role flags can be manipulated.
- Reconnect and token refresh behavior may produce race conditions.
- Unknown quality should remain unknown, not be represented as healthy.
- No-op controls can mislead users.

**Required action:**
- Define versioned event schemas with event IDs, meeting/speaker identity, sequence numbers, timestamps, language and interim/final status.
- Validate message size, schema, sender identity, ordering, and duplicate events.
- Derive permissions from server-issued claims and authoritative backend state.
- Replace no-op controls with implemented behavior or hide/disable them.
- Add reconnection and device-switching tests.

### 3.5 Multilingual captions and translation — High

**Known baseline:**
- Browser Web Speech API is used for speech recognition and language support is described for 11 Indian languages.
- Translation and caption events are not yet known to have a robust production streaming architecture.

**Risk:**
- Browser-native speech APIs vary by browser, device, language, and network.
- Recognition output alone does not provide a complete translation pipeline.
- Code-switching, speaker attribution, partial/final segment handling, regional accents, and translation consistency require dedicated design and measurement.

**Required action:**
- Make browser speech an optional fallback, not the sole production speech path.
- Build provider adapters for streaming ASR and translation.
- Preserve source transcript independently of translations.
- Translate once per unique target language for each finalized segment, then fan out to participants.
- Add language-pair quality and latency benchmarks before selecting a default provider.

### 3.6 AI meeting intelligence — High

**Known baseline:** Groq is used for AI meeting notes.

**Verify:**
- Whether AI jobs are synchronous or queued.
- Whether summaries are grounded in stored transcript segments.
- Whether outputs are schema-validated and versioned.
- Whether meeting authorization is enforced for every transcript/summary retrieval.
- Whether provider keys are exclusively server-side.

**Required action:** Use asynchronous jobs, structured output schemas, source segment references, retries, provider abstraction, and explicit “needs review” states for uncertain action items.

### 3.7 Deployment and operations — High / Verify

Firebase Hosting and Render are referenced in the current project description.

Verify:
- Production/staging separation.
- Secret management and rotation.
- Database backups and restore tests.
- TLS and domain configuration.
- Health/readiness endpoints.
- Centralized logs, metrics, tracing, and alerting.
- Deployment rollback.
- LiveKit webhook signature validation.
- Provider quotas, timeouts, and regional availability.

## 4. Required repository audit checklist

Run this checklist against the current default branch and record the commit SHA.

- [ ] Capture repository tree and package manager/workspace configuration.
- [ ] Inventory all API routes and middleware.
- [ ] Trace registration, login, refresh, logout, verification, and password reset.
- [ ] Identify every place that reads/writes auth tokens or cached users.
- [ ] Identify every database/file/in-memory persistence path.
- [ ] Trace meeting creation, joining, admission, leave, and room cleanup.
- [ ] Trace LiveKit token creation and verify all authorization checks.
- [ ] Inventory all LiveKit data event types and schemas.
- [ ] Trace audio capture → ASR → translation → caption rendering.
- [ ] Inventory provider keys and confirm no secret is bundled into clients.
- [ ] Identify recording/transcript storage, consent, deletion, and retention behavior.
- [ ] Run existing unit, integration, build, lint, and E2E tests.
- [ ] Run dependency and secret scanning.
- [ ] Record known defects and current performance baselines.

## 5. Initial risk register

| ID | Risk | Severity | Priority | Exit condition |
|---|---|---:|---:|---|
| R-01 | Hardcoded JWT fallback | Critical | P0 | No fallback; startup fails without configured secret/provider |
| R-02 | JSON/in-memory authoritative identity | Critical | P0 | PostgreSQL-backed identity and tested migration |
| R-03 | Ephemeral meeting/admission state | Critical | P0 | Durable state machine and restart-safe tests |
| R-04 | Weak or incomplete RTC token authorization | Critical | P0 | Negative authorization tests pass |
| R-05 | Client-trusted role flags | Critical | P0 | Server-derived role and permission enforcement |
| R-06 | Auth provider ambiguity | High | P0 | One authoritative identity and documented session flows |
| R-07 | Minimal caption event schema | High | P1 | Versioned validated contract |
| R-08 | Browser-dependent ASR reliability | High | P1 | Provider benchmark and fallback policy |
| R-09 | Missing operational visibility | High | P1 | Logs, metrics, traces, alerts, runbooks |
| R-10 | Unclear retention/consent controls | High | P0 | Policies, consent evidence, deletion workflow |

## 6. Audit conclusion

The current baseline is suitable for planning an incremental hardening program, not for declaring public-launch readiness. Preserve the existing working meeting experience while replacing unsafe sources of truth and tightening authorization. Do not perform a broad rewrite until the complete route, data-flow, and test inventories are recorded.
