import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET ||= 'test-secret-at-least-16-chars';
process.env.ML_INTERNAL_KEY ||= 'test-internal-key';

const { default: request } = await import('supertest');
const { createApp } = await import('../src/app.js');
const app = createApp();

test('GET /api/health responds with service status', async () => {
  const res = await request(app).get('/api/health').expect(200);
  assert.equal(res.body.status, 'ok');
  assert.ok(['not_configured', 'connected', 'disconnected', 'connecting'].includes(res.body.db));
  assert.ok(res.body.mlService.status);
});

test('unknown routes return a JSON 404', async () => {
  const res = await request(app).get('/api/nope').expect(404);
  assert.match(res.body.error.message, /Route not found/);
});
