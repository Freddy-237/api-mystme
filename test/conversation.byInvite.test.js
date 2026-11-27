// A returning web visitor finds their conversation from the invite code.
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const app = require('../src/app');
const env = require('../src/config/env');
const pool = require('../src/config/database');

let ip = 0;
async function initIdentity(origin) {
  ip += 1;
  const res = await request(app)
    .post('/identity/init')
    .set('x-forwarded-for', `10.8.0.${ip}`)
    .send(origin ? { client: origin } : {})
    .expect(201);
  const setCookie = res.headers['set-cookie'] || [];
  const authCookie = (setCookie.find((h) => h.startsWith(`${env.authCookieName}=`)) || '').split(';')[0];
  const csrfCookie = (setCookie.find((h) => h.startsWith(`${env.csrfCookieName}=`)) || '').split(';')[0];
  return { token: res.body.token, user: res.body.user, authCookie, csrfToken: csrfCookie.split('=')[1] };
}
const authed = (req, a) => req
  .set('Authorization', `Bearer ${a.token}`)
  .set('Cookie', a.authCookie)
  .set(env.csrfHeaderName || 'x-csrf-token', a.csrfToken);

test('by-invite returns the existing conversation and never creates one', async () => {
  const owner = await initIdentity();
  const visitor = await initIdentity('web');
  const link = await request(app).post('/link').set('Authorization', `Bearer ${owner.token}`).expect(201);
  const code = link.body.code;

  // Nothing yet: 404, and no conversation row was created by the lookup.
  await authed(request(app).get(`/conversation/by-invite/${code}`), visitor).expect(404);
  const none = await pool.query('SELECT COUNT(*)::int AS n FROM conversations WHERE anonymous_id = $1', [visitor.user.id]);
  assert.equal(none.rows[0].n, 0);

  // Opened but never written to: still nothing to come back to.
  const resolved = await authed(request(app).post('/conversation/resolve-link').send({ inviteCode: code }), visitor).expect(200);
  await authed(request(app).get(`/conversation/by-invite/${code}`), visitor).expect(404);

  await authed(request(app).post('/message').send({ conversationId: resolved.body.conversationId, content: 'coucou' }), visitor).expect(201);
  const found = await authed(request(app).get(`/conversation/by-invite/${code}`), visitor).expect(200);
  assert.equal(found.body.conversationId, resolved.body.conversationId);
  assert.ok(found.body.targetPseudo);

  // Someone else with the same link does not see it.
  const stranger = await initIdentity('web');
  await authed(request(app).get(`/conversation/by-invite/${code}`), stranger).expect(404);

  // Still reachable after the owner deactivates the link.
  await request(app).delete(`/link/${link.body.id}`).set('Authorization', `Bearer ${owner.token}`);
  await authed(request(app).get(`/conversation/by-invite/${code}`), visitor).expect(200);
});
