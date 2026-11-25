# Repository Baseline (M1.0)

## Directory Structure
```
AuraClave/
├─ backend/                 # Node/Express server
│   ├─ src/                # TypeScript source
│   ├─ lib/                # Utilities
│   └─ tests/              # Backend tests
├─ nexmeet/                # React Vite frontend
│   ├─ src/                # UI components, contexts, hooks
│   ├─ public/             # Static assets
│   └─ tests/              # Frontend tests (Vitest)
├─ mobile/                 # Expo React Native app
│   ├─ app/                # RN source
│   └─ ...
├─ .git/                   # Git repository
├─ package.json            # Root monorepo scripts
├─ backend/package.json    # Backend specific
├─ nexmeet/package.json    # Frontend specific
└─ ...
``` 

## Package Managers
- Root uses **npm** (lockfile `package-lock.json`).
- Each workspace has its own `package.json`.

## Backend Entry Points
- `backend/src/index.ts` – starts Express server.
- `backend/src/app.ts` – configures middleware, routes.

## Frontend Authentication
- `nexmeet/src/contexts/AuthContext.tsx` provides user context.
- `nexmeet/src/lib/auth.ts` contains helper functions for API calls.

## Persistence
- JSON file based user store under `backend/data/users.json` (currently used for registration/login).
- In‑memory room management in `backend/src/rooms.ts`.

## LiveKit Integration
- Token generation in `backend/src/lib/livekit.ts` (`/api/livekit/token`).
- Webhooks handled in `backend/src/lib/livekit-webhook.ts`.

## Mobile App
- Expo app under `mobile/auraclave/` using the same backend API.

## Tests
- Backend unit tests with **Vitest** under `backend/tests/`.
- Frontend component tests with **Vitest** under `nexmeet/tests/`.
- End‑to‑end tests with **Playwright** (not yet configured).

## Environment Variables (currently)
- `JWT_SECRET` – required signing secret; no fallback is generated.
- `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`.
- `GROQ_API_KEY`.
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`.
- `DATABASE_URL` – not used yet (JSON persistence).

---
*This baseline captures the current state before any production‑oriented changes.*