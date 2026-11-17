// Integration tests (need the test database, run in CI).
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const app = require('../src/app');
const pool = require('../src/config/database');
const { WEB_MESSAGE_LIMIT } = require('../src/config/webTrial');

let ipCounter = 0;
const nextIp = () => `203.0.113.${(ipCounter++ % 200) + 20}`;

const init = async (client) => {
  const res = await request(app)
    .post('/identity/init')
    .set('x-forwarded-for', nextIp())
    .send(client ? { client } : {})
    .expect(201);
  return { token: res.body.token, user: res.body.user };
};

const auth = (token) => ({ Authorization: `Bearer ${token}` });

const openConversation = async (owner, visitor) => {
  const link = await request(app).post('/link').set(auth(owner.token)).expect(201);
  const resolved = await request(app)
    .post('/conversation/resolve-link')
    .set(auth(visitor.token))
    .send({ inviteCode: link.body.code })
    .expect(200);
  return { link: link.body, conversationId: resolved.body.conversationId };
};

test('identity origin: PWA → web with expiry, default → app', async () => {
  const web = await init('web');
  const appUser = await init();
  assert.equal(web.user.origin, 'web');
  assert.equal(typeof web.user.web_expires_at, 'string');
  assert.equal(web.user.web_locked, false);
  assert.equal(appUser.user.origin, 'app');
  assert.equal(appUser.user.web_expires_at, null);
});

test('POST /link is idempotent: one active link per user', async () => {
  const owner = await init();
  const first = await request(app).post('/link').set(auth(owner.token)).expect(201);
  const second = await request(app).post('/link').set(auth(owner.token)).expect(200);
  assert.equal(second.body.id, first.body.id);

  const mine = await request(app).get('/link/mine').set(auth(owner.token)).expect(200);
  assert.equal(mine.body.filter((l) => l.is_active).length, 1);
});

test('web identities cannot create a link', async () => {
  const web = await init('web');
  const res = await request(app).post('/link').set(auth(web.token)).expect(403);
  assert.equal(res.body.code, 'APP_REQUIRED');
});

test('owner only sees a conversation after the first message', async () => {
  const owner = await init();
  const visitor = await init('web');
  const { conversationId } = await openConversation(owner, visitor);

  const before = await request(app).get('/conversation/mine').set(auth(owner.token)).expect(200);
  assert.ok(!before.body.items.some((c) => c.id === conversationId));

  await request(app)
    .post('/message')
    .set(auth(visitor.token))
    .send({ conversationId, content: 'coucou' })
    .expect(201);

  const after = await request(app).get('/conversation/mine').set(auth(owner.token)).expect(200);
  const conv = after.body.items.find((c) => c.id === conversationId);
  assert.ok(conv, 'conversation visible after first message');
  assert.equal(typeof conv.started_at, 'string');
});

test('web message limit is enforced by the server', async () => {
  const owner = await init();
  const visitor = await init('web');
  const { conversationId } = await openConversation(owner, visitor);

  for (let i = 0; i < WEB_MESSAGE_LIMIT; i += 1) {
    await request(app)
      .post('/message')
      .set(auth(visitor.token))
      .send({ conversationId, content: `msg ${i}` })
      .expect(201);
  }
  const blocked = await request(app)
    .post('/message')
    .set(auth(visitor.token))
    .send({ conversationId, content: 'one too many' })
    .expect(403);
  assert.equal(blocked.body.code, 'WEB_MESSAGE_LIMIT');

  // The app user is never limited.
  await request(app)
    .post('/message')
    .set(auth(owner.token))
    .send({ conversationId, content: 'réponse' })
    .expect(201);
});

test('web identity is read-only after its window, but can still read', async () => {
  const owner = await init();
  const visitor = await init('web');
  const { conversationId } = await openConversation(owner, visitor);
  await request(app)
    .post('/message')
    .set(auth(visitor.token))
    .send({ conversationId, content: 'avant' })
    .expect(201);

  await pool.query(
    "UPDATE users SET web_expires_at = NOW() - INTERVAL '1 minute' WHERE id = $1",
    [visitor.user.id],
  );

  const res = await request(app)
    .post('/message')
    .set(auth(visitor.token))
    .send({ conversationId, content: 'après' })
    .expect(403);
  assert.equal(res.body.code, 'WEB_TRIAL_EXPIRED');

  await request(app).get(`/message/${conversationId}`).set(auth(visitor.token)).expect(200);
  const me = await request(app).get('/identity/me').set(auth(visitor.token)).expect(200);
  assert.equal(me.body.web_locked, true);
});
