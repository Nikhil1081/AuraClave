import type { Request, Response } from 'express';
import { describe, it, expect, vi } from 'vitest';
import { rootHealthHandler, healthHandler } from '../src/lib/health.js';

/**
 * Health endpoint tests.
 *
 * These tests import the EXACT handler functions registered in production
 * (backend/src/lib/health.ts → used by backend/src/server.ts).
 *
 * A minimal Express app is used to mount those handlers because the full
 * production server cannot be imported in test without real LiveKit / Groq
 * credentials. The handlers themselves are identical to production.
 *
 * Limitation: middleware (security headers, CORS, body-parser) is not tested here.
 * Integration tests covering the full server are planned for M1.1+.
 */
function createResponseMock() {
  let response: Response;
  const status = vi.fn(() => response);
  const json = vi.fn((_body?: unknown) => response);
  response = { status, json } as unknown as Response;
  return { response, status, json };
}

describe('Production health handlers', () => {
  it('GET /health returns { status: "healthy" }', async () => {
    const { response, status, json } = createResponseMock();
    healthHandler({} as Request, response);
    expect(status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith({ status: 'healthy' });
  });

  it('GET / returns { status: "ok", service: "AuraClave API" }', async () => {
    const { response, status, json } = createResponseMock();
    rootHealthHandler({} as Request, response);
    expect(status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'ok',
        service: 'AuraClave API',
        timestamp: expect.any(String)
      })
    );
    const body = json.mock.calls[0]?.[0];
    if (!body || typeof body !== 'object' || !('timestamp' in body)) {
      throw new Error('The root health response must include a timestamp.');
    }
    expect(typeof body.timestamp).toBe('string');
  });
});
