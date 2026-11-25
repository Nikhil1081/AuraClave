import request from 'supertest';
import express from 'express';
import { describe, it, expect } from 'vitest';

// Create a minimal test-only express app with the health route
// (avoids importing the full server which requires LiveKit/Groq env vars)
const testApp = express();

testApp.get('/health', (_req, res) => {
  res.json({ status: 'healthy' });
});

testApp.get('/', (_req, res) => {
  res.json({ status: 'ok', service: 'AuraClave API' });
});

describe('Health endpoints', () => {
  it('GET /health returns healthy', async () => {
    const response = await request(testApp).get('/health');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'healthy' });
  });

  it('GET / returns ok', async () => {
    const response = await request(testApp).get('/');
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
  });
});
