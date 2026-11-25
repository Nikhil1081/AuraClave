# Dependency Inventory (M1.0)

## Root
- `package-lock.json` – npm lockfile.
- `package.json` – defines monorepo scripts (`install:backend`, `build`, `start`).

## Backend (`backend/package.json`)
- Runtime: **Node.js 22** (as used in Render). 
- Framework: **Express 4**.
- Language: **TypeScript 5.8**.
- Key deps:
  - `cors`, `dotenv`, `jsonwebtoken`, `livekit-server-sdk`, `ws`.
  - `bcryptjs` for password hashing.
  - Types for Node, Express, WS, JWT, Bcrypt.
- Dev deps: `tsx` (watcher).

## Frontend (`nexmeet/package.json`)
- Build: **Vite 7**, **React 19**.
- Tooling: `typescript`, `vitest`, `@testing-library/react`.
- UI libs: `lucide-react`, `react-router-dom`.
- State: custom contexts (AuthContext, LanguageContext).
- Integration: Supabase client (`@supabase/supabase-js`).

## Mobile (`mobile/auraclave/package.json`)
- Expo SDK, React Native, TypeScript.
- Uses same backend API endpoints.

## Development Tools
- Docker Compose (`docker-compose.livekit.yml`).
- LiveKit server config (`livekit.yaml`).
- ESLint config (if present) – not found, will be added.
- Prettier config – not found, will be added.

**All dependencies are version‑pinned in lockfiles; no duplicate ORM or DB drivers currently exist.**