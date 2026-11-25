/**
 * Health route handlers — imported by both server.ts and the test suite.
 * This allows the test to exercise the exact same handler code that runs in production,
 * without needing to boot the full server (which requires LiveKit / Groq env vars).
 */
import type { Request, Response } from 'express';

export function rootHealthHandler(_req: Request, res: Response): void {
  res.json({ status: 'ok', service: 'AuraClave API', timestamp: new Date().toISOString() });
}

export function healthHandler(_req: Request, res: Response): void {
  res.json({ status: 'healthy' });
}
