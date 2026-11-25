import request from 'supertest';
import express from 'express';
import { describe, it, expect } from 'vitest';
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
const testApp = express();
testApp.get('/', rootHealthHandler);
testApp.get('/health', healthHandler);

describe('Production health handlers', () => {
  it('GET /health returns { status: "healthy" }', async () => {
    const response = await request(testApp).get('/health');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'healthy' });
  });

  it('GET / returns { status: "ok", service: "AuraClave API" }', async () => {
    const response = await request(testApp).get('/');
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
    expect(response.body.service).toBe('AuraClave API');
    expect(typeof response.body.timestamp).toBe('string');
  });
});
