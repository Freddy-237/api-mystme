const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const app = require('../src/app');

test('health endpoint returns service status and database status', async () => {
  const res = await request(app).get('/health');

  assert.equal(res.status, 200);
  assert.equal(res.body.error, undefined);
  assert.equal(typeof res.body.status, 'string');
  assert.equal(typeof res.body.db, 'string');
  assert.equal(typeof res.body.cloudinary, 'string');
  assert.equal(typeof res.body.email, 'object');
  assert.equal(typeof res.body.email.provider, 'string');
  assert.equal(typeof res.body.email.smtp, 'string');
  assert.equal(typeof res.body.email.brevo, 'string');
  assert.equal(typeof res.body.timestamp, 'string');
});

test('disallowed origin is rejected with 403 and CORS error message', async () => {
  const res = await request(app)
    .get('/health')
    .set('Origin', 'https://evil.example');

  assert.equal(res.status, 403);
  assert.equal(res.body.error, true);
  assert.equal(res.body.message, 'CORS origin denied');
  assert.ok(typeof res.headers['x-request-id'] === 'string');
});

test('disallowed origin still returns a request id header for tracing', async () => {
  const res = await request(app)
    .get('/health')
    .set('Origin', 'https://evil.example');

  assert.equal(res.status, 403);
  assert.ok(typeof res.headers['x-request-id'] === 'string');
});

test('allowed origin passes CORS and returns access-control-allow-origin header', async () => {
  const res = await request(app)
    .get('/health')
    .set('Origin', 'http://localhost:5173');

  assert.equal(res.status, 200);
  assert.equal(res.headers['access-control-allow-origin'], 'http://localhost:5173');
  assert.equal(res.body.status, 'ok');
});
