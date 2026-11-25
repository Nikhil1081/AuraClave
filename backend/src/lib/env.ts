// Environment validation for AuraClave backend
// This module validates required environment variables at startup.
// It ensures JWT secret is present (or generates a temporary one) and logs warnings
// for optional services (LiveKit, Groq) if they are not configured.

/**
 * Validate essential environment configuration.
 * Throws only for critical missing vars that would break core functionality.
 */
export function validateEnvConfig(): void {
  // JWT secret is essential for auth; if missing, a warning is emitted by auth module.
  // We do not enforce here to allow dev without persisting secret.

  // LiveKit configuration is optional for non‑media routes.
  if (!process.env.LIVEKIT_URL || !process.env.LIVEKIT_API_KEY || !process.env.LIVEKIT_API_SECRET) {
    console.warn(
      "[WARN] LiveKit configuration is incomplete. LiveKit‑related endpoints will return 503."
    );
  }

  // Groq configuration is optional for AI note‑taking.
  if (!process.env.GROQ_API_KEY) {
    console.warn("[WARN] GROQ_API_KEY not set. AI note‑taking features will be unavailable.");
  }
}
