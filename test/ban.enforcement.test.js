const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const app = require('../src/app');
const env = require('../src/config/env');
const pool = require('../src/config/database');
const { authenticateToken, BANNED_ACCOUNT_MESSAGE } = require('../src/modules/identity/identity.auth');

function extractCookie(setCookieHeaders, cookieName) {
  const headers = setCookieHeaders || [];
  const raw = headers.find((h) => h.startsWith(`${cookieName}=`));
  if (!raw) return null;
  return raw.split(';')[0];
}

async function initIdentity() {
  const res = await request(app).post('/identity/init').expect(201);
  return {
    token: res.body.token,
    user: res.body.user,
    setCookie: res.headers['set-cookie'] || [],
  };
}

async function banUser(userId, reason = 'test ban') {
  await pool.query(
    `UPDATE users
        SET is_banned = TRUE,
            ban_reason = $2,
            banned_at = NOW()
      WHERE id = $1`,
    [userId, reason],
  );
}

test('banned user is blocked by HTTP bearer auth', async () => {
  const identity = await initIdentity();
  await banUser(identity.user.id);

  const res = await request(app)
    .get('/identity/me')
    .set('Authorization', `Bearer ${identity.token}`)
    .expect(403);

  assert.equal(res.body?.message, BANNED_ACCOUNT_MESSAGE);
});

test('banned user is blocked when requesting a fresh session token', async () => {
  const identity = await initIdentity();
  await banUser(identity.user.id);

  const authCookie = extractCookie(identity.setCookie, env.authCookieName);
  assert.ok(authCookie, 'auth cookie should be set');

  const res = await request(app)
    .get('/identity/session-token')
    .set('Cookie', authCookie)
    .expect(403);

  assert.equal(res.body?.message, BANNED_ACCOUNT_MESSAGE);
});

test('banned user token is rejected by the shared realtime authenticator', async () => {
  const identity = await initIdentity();
  await banUser(identity.user.id);

  await assert.rejects(
    () => authenticateToken(identity.token),
    (error) => {
      assert.equal(error?.statusCode, 403);
      assert.equal(error?.message, BANNED_ACCOUNT_MESSAGE);
      return true;
    },
  );
});