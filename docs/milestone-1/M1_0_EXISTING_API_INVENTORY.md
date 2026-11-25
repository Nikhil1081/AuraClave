# Existing API Inventory (M1.0)

## Backend API Endpoints
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/livekit/token` | Generates a LiveKit access token for a meeting (uses `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET`). |
| POST | `/api/webhooks/livekit` | Handles LiveKit webhook events (e.g., participant join/leave). |
| POST | `/api/auth/register` *(legacy)* | Registers a user using JSON file persistence. |
| POST | `/api/auth/login` *(legacy)* | Authenticates a user, issues a JWT signed with the configured `JWT_SECRET`. |
| GET | `/api/auth/me` *(legacy)* | Returns the current authenticated user profile. |
| POST | `/api/notes` | Receives meeting transcription notes, forwards to Groq for summarization. |
| ... | Additional routes for meeting creation, joining, and chat are defined in `backend/src/routes/*.ts`. |

## Frontend API Calls (via `nexmeet/src/lib/auth.ts`)
- `register(email, password, name)` → POST `/api/auth/register`
- `login(email, password)` → POST `/api/auth/login`
- `logout()` → POST `/api/auth/logout`
- `refreshToken()` → POST `/api/auth/refresh`
- `getCurrentUser()` → GET `/api/auth/me`
- `fetchLiveKitToken(roomName)` → GET `/api/livekit/token?room=${roomName}`

## Mobile API Calls (similar to web, defined in `mobile/auraclave/src/api/*.ts`)
- Uses the same `/api/auth/*` endpoints and LiveKit token endpoint.

> **Note:** The current API layer is thin and largely forwards to the JSON‑based user store. No relational database or ORM is used yet.
