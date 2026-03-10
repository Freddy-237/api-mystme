const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const app = require('../src/app');
const env = require('../src/config/env');

function extractCookie(setCookieHeaders, cookieName) {
  const headers = setCookieHeaders || [];
  const raw = headers.find((h) => h.startsWith(`${cookieName}=`));
  if (!raw) return null;
  return raw.split(';')[0];
}

test('identity init sets auth + csrf cookies and returns token', async () => {
  const res = await request(app)
    .post('/identity/init')
    .expect(201);

  assert.equal(typeof res.body?.token, 'string');
  assert.equal(typeof res.body?.user?.id, 'string');

  const setCookie = res.headers['set-cookie'] || [];
  const authCookie = extractCookie(setCookie, env.authCookieName);
  const csrfCookie = extractCookie(setCookie, env.csrfCookieName);

  assert.ok(authCookie, 'auth cookie should be set');
  assert.ok(csrfCookie, 'csrf cookie should be set');
});

test('logout with cookie auth but missing csrf header is rejected', async () => {
  const initRes = await request(app)
    .post('/identity/init')
    .expect(201);

  const setCookie = initRes.headers['set-cookie'] || [];
  const authCookie = extractCookie(setCookie, env.authCookieName);

  assert.ok(authCookie, 'auth cookie should be set');

  await request(app)
    .post('/identity/logout')
    .set('Cookie', authCookie)
    .expect(403);
});

test('logout with matching csrf header succeeds', async () => {
  const initRes = await request(app)
    .post('/identity/init')
    .expect(201);

  const setCookie = initRes.headers['set-cookie'] || [];
  const authCookie = extractCookie(setCookie, env.authCookieName);
  const csrfCookie = extractCookie(setCookie, env.csrfCookieName);

  assert.ok(authCookie, 'auth cookie should be set');
  assert.ok(csrfCookie, 'csrf cookie should be set');

  const csrfToken = csrfCookie.split('=')[1];

  const res = await request(app)
    .post('/identity/logout')
    .set('Cookie', `${authCookie}; ${csrfCookie}`)
    .set(env.csrfHeaderName, csrfToken)
    .expect(200);

  assert.equal(res.body?.ok, true);
});

test('bearer token auth still works on protected endpoint', async () => {
  const initRes = await request(app)
    .post('/identity/init')
    .expect(201);

  const token = initRes.body?.token;
  assert.equal(typeof token, 'string');

  const meRes = await request(app)
    .get('/identity/me')
    .set('Authorization', `Bearer ${token}`)
    .expect(200);

  assert.equal(typeof meRes.body?.id, 'string');
  assert.equal(meRes.body?.notifications_enabled, true);
});

test('notification preference is persisted on the user profile', async () => {
  const initRes = await request(app)
    .post('/identity/init')
    .expect(201);

  const token = initRes.body?.token;
  assert.equal(typeof token, 'string');

  const updateRes = await request(app)
    .patch('/identity/notifications')
    .set('Authorization', `Bearer ${token}`)
    .send({ enabled: false })
    .expect(200);

  assert.equal(updateRes.body?.notifications_enabled, false);
  assert.equal(updateRes.body?.push_token ?? null, null);

  const meRes = await request(app)
    .get('/identity/me')
    .set('Authorization', `Bearer ${token}`)
    .expect(200);

  assert.equal(meRes.body?.notifications_enabled, false);
});

test('session-token returns a bearer token for authenticated cookie session', async () => {
  const initRes = await request(app)
    .post('/identity/init')
    .expect(201);

  const setCookie = initRes.headers['set-cookie'] || [];
  const authCookie = extractCookie(setCookie, env.authCookieName);

  assert.ok(authCookie, 'auth cookie should be set');

  const tokenRes = await request(app)
    .get('/identity/session-token')
    .set('Cookie', authCookie)
    .expect(200);

  assert.equal(typeof tokenRes.body?.token, 'string');
  assert.ok(tokenRes.body.token.length > 20, 'session token should look like a JWT');
});
