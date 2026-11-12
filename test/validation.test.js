const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const app = require('../src/app');
const env = require('../src/config/env');

// ── helpers ──

async function initIdentity() {
  const res = await request(app).post('/identity/init').expect(201);
  const setCookie = res.headers['set-cookie'] || [];
  const authCookie = (setCookie.find((h) => h.startsWith(`${env.authCookieName}=`)) || '').split(';')[0];
  const csrfCookie = (setCookie.find((h) => h.startsWith(`${env.csrfCookieName}=`)) || '').split(';')[0];
  const csrfToken = csrfCookie.split('=')[1];
  return { token: res.body.token, user: res.body.user, authCookie, csrfToken };
}

function authed(req, { token, authCookie, csrfToken }) {
  return req
    .set('Authorization', `Bearer ${token}`)
    .set('Cookie', authCookie)
    .set('x-csrf-token', csrfToken);
}

// ── Pseudo validation ──

test('updatePseudo rejects pseudo shorter than 2 chars', async () => {
  const id = await initIdentity();
  const res = await authed(
    request(app).patch('/identity/pseudo').send({ pseudo: 'A' }),
    id,
  );
  assert.equal(res.status, 400);
});

test('updatePseudo rejects pseudo longer than 30 chars', async () => {
  const id = await initIdentity();
  const res = await authed(
    request(app).patch('/identity/pseudo').send({ pseudo: 'A'.repeat(31) }),
    id,
  );
  assert.equal(res.status, 400);
});

test('updatePseudo accepts valid pseudo', async () => {
  const id = await initIdentity();
  const res = await authed(
    request(app).patch('/identity/pseudo').send({ pseudo: 'ValidPseudo' }),
    id,
  );
  assert.equal(res.status, 200);
});

test('updatePseudo regenerates identity when pseudo is omitted', async () => {
  const id = await initIdentity();
  const previousPseudo = id.user.pseudo;
  const previousAvatar = id.user.avatar_url;

  const res = await authed(
    request(app).patch('/identity/pseudo').send({}),
    id,
  );

  assert.equal(res.status, 200);
  assert.equal(typeof res.body.pseudo, 'string');
  assert.ok(res.body.pseudo.length >= 2);
  assert.equal(typeof res.body.avatar_url, 'string');
  assert.notEqual(res.body.pseudo, previousPseudo);
  assert.notEqual(res.body.avatar_url, previousAvatar);
});

// ── Bio validation ──

test('updateBio rejects bio > 300 chars', async () => {
  const id = await initIdentity();
  const res = await authed(
    request(app).patch('/identity/bio').send({ bio: 'x'.repeat(301) }),
    id,
  );
  assert.equal(res.status, 400);
});

test('updateBio accepts valid bio', async () => {
  const id = await initIdentity();
  const res = await authed(
    request(app).patch('/identity/bio').send({ bio: 'Hello world' }),
    id,
  );
  assert.equal(res.status, 200);
});

// ── Auth-required routes without token ──

test('trust endpoint without auth returns 401', async () => {
  const res = await request(app).get('/trust/nonexistent');
  assert.equal(res.status, 401);
  assert.equal(res.body?.error, true);
  assert.equal(res.body?.message, 'Authentification requise');
});

test('moderation report without auth returns 401', async () => {
  const res = await request(app).post('/moderation/report').send({ conversationId: '123', reason: 'spam' });
  assert.equal(res.status, 401);
  assert.equal(res.body?.error, true);
  assert.equal(res.body?.message, 'Authentification requise');
});

test('link mine without auth returns 401', async () => {
  const res = await request(app).get('/link/mine');
  assert.equal(res.status, 401);
  assert.equal(res.body?.error, true);
  assert.equal(res.body?.message, 'Authentification requise');
});

test('conversation get with invalid UUID returns 400', async () => {
  const user = await request(app).post('/identity/init').expect(201);
  const token = user.body.token;
  const res = await request(app)
    .get('/conversation/invalid-uuid')
    .set('Authorization', `Bearer ${token}`);
  assert.equal(res.status, 400);
  assert.equal(res.body?.error, true);
});
