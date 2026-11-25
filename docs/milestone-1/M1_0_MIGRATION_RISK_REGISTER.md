# M1.0 Migration Risk Register

## Overview
This register identifies risks associated with the planned transition from the current AuraClave architecture to a production-ready system. All risks are based on direct inspection of the repository.

---

## RISK-001 — JSON File User Store (High)

| Field       | Detail |
|-------------|--------|
| **Status**  | Active |
| **Severity**| High |
| **Area**    | Persistence |
| **Description** | User accounts are stored in `backend/data/users.json`. Concurrent writes are not safe; file is lost on deploy if the host does not persist the filesystem. |
| **Impact**  | Data loss in production on ephemeral hosts (e.g., Render free tier). Authentication breaks if file is corrupted. |
| **Mitigation** | Plan to migrate to PostgreSQL in M1.1. Until then, `users.json` must be backed up before each deploy. Do not deploy to ephemeral filesystems without a persistent disk mount. |

---

## RISK-002 — Ephemeral JWT Secret (High)

| Field       | Detail |
|-------------|--------|
| **Status**  | Active |
| **Severity**| High |
| **Area**    | Security / Authentication |
| **Description** | `backend/src/auth.ts` generates a random JWT secret per process restart when `JWT_SECRET` is not set. All existing sessions are invalidated on each restart. |
| **Impact**  | Users are signed out every time the backend restarts. Tokens cannot be verified across multiple backend instances (horizontal scaling breaks). |
| **Mitigation** | Set `JWT_SECRET` as a persistent environment variable in all environments. This is documented in `backend/.env.example`. |

---

## RISK-003 — In-Memory Room Management (Medium)

| Field       | Detail |
|-------------|--------|
| **Status**  | Active |
| **Severity**| Medium |
| **Area**    | Meeting State |
| **Description** | Room state (host, waiting list, admission decisions) is managed in-memory via `backend/src/roomManager.ts`. All state is lost on backend restart. |
| **Impact**  | Active meetings are disrupted when the backend restarts. Waiting participants lose their status. |
| **Mitigation** | Acceptable for current single-instance MVP. Future work (M1.2+) should persist room state to Redis or PostgreSQL. |

---

## RISK-004 — Broad CORS Policy (Medium)

| Field       | Detail |
|-------------|--------|
| **Status**  | Active |
| **Severity**| Medium |
| **Area**    | Security |
| **Description** | `server.ts` configures CORS with `origin: true`, which reflects any origin. |
| **Impact**  | Cross-origin requests from any domain are accepted. Potential CSRF risk if cookies are introduced. |
| **Mitigation** | Restrict `cors` to known origins (`ALLOWED_ORIGINS` env var) before production launch. Currently acceptable since auth is Bearer-token based (not cookies). |

---

## RISK-005 — No Backend Automated Tests (Medium)

| Field       | Detail |
|-------------|--------|
| **Status**  | Partially Mitigated (M1.0) |
| **Severity**| Medium |
| **Area**    | Quality / CI |
| **Description** | No backend tests existed prior to M1.0. Regressions in auth, meeting, or LiveKit routes would go undetected. |
| **Impact**  | Silent breakage when refactoring. CI cannot block broken deploys. |
| **Mitigation** | Health endpoint test added in M1.0. Full route-level tests (auth, meeting join, admission flow) to be added in M1.1+. |

---

## RISK-006 — Supabase Frontend Auth Remnants (Low)

| Field       | Detail |
|-------------|--------|
| **Status**  | Active |
| **Severity**| Low |
| **Area**    | Authentication |
| **Description** | Frontend `nexmeet/src/lib/auth.ts` previously integrated Supabase auth. It has been migrated to custom backend auth, but Supabase references may still exist in some components. |
| **Impact**  | Build warnings; potential confusion when debugging auth flows. |
| **Mitigation** | Audit all Supabase imports in `nexmeet/src/` as part of M1.1 cleanup. |

---

## RISK-007 — No Environment Validation at Startup (Low)

| Field       | Detail |
|-------------|--------|
| **Status**  | Mitigated (M1.0) |
| **Severity**| Low |
| **Area**    | Operations |
| **Description** | Backend previously started without validating required environment variables. |
| **Impact**  | Silent misconfigurations (e.g., missing LiveKit URL) would only surface at runtime when routes are called. |
| **Mitigation** | `backend/src/lib/env.ts` added in M1.0, imported at server startup to log warnings for missing optional services. |

---

*Last updated: M1.0 — 2026-11-25*
