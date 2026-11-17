// Integration tests for PWA → app transfer (need the test database, run in CI).
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const app = require('../src/app');
const pool = require('../src/config/database');

let ip = 0;
const nextIp = () => `198.18.0.${(ip++ % 200) + 20}`;
const auth = (token) => ({ Authorization: `Bearer ${token}` });

const init = async (client) => {
  const res = await request(app)
    .post('/identity/init')
    .set('x-forwarded-for', nextIp())
    .send(client ? { client } : {})
    .expect(201);
  return { token: res.body.token, user: res.body.user };
};

const linkOf = async (owner) =>
  (await request(app).post('/link').set(auth(owner.token))).body;

const writeVia = async (visitor, link, content) => {
  const resolved = await request(app)
    .post('/conversation/resolve-link')
    .set(auth(visitor.token))
    .send({ inviteCode: link.code })
    .expect(200);
  await request(app)
    .post('/message')
    .set(auth(visitor.token))
    .send({ conversationId: resolved.body.conversationId, content })
    .expect(201);
  return resolved.body.conversationId;
};

const transferCode = async (web) =>
  (await request(app)
    .post('/identity/transfer-token')
    .set('x-forwarded-for', nextIp())
    .set(auth(web.token))
    .expect(201)).body.code;

const claim = (appUser, code) =>
  request(app)
    .post('/identity/transfer/claim')
    .set('x-forwarded-for', nextIp())
    .set(auth(appUser.token))
    .send({ code });

test('web conversation appears in the app after transfer, alias unchanged', async () => {
  const owner = await init();
  const web = await init('web');
  const link = await linkOf(owner);
  const conversationId = await writeVia(web, link, 'coucou du web');

  const ownerBefore = await request(app).get(`/conversation/${conversationId}`).set(auth(owner.token)).expect(200);

  const appUser = await init('app');
  const code = await transferCode(web);
  const res = await claim(appUser, code).expect(200);
  assert.deepEqual(res.body.conversationIds, [conversationId]);

  const mine = await request(app).get('/conversation/mine').set(auth(appUser.token)).expect(200);
  const conv = mine.body.items.find((c) => c.id === conversationId);
  assert.ok(conv, 'conversation now belongs to the app user');
  assert.equal(conv.last_message, 'coucou du web');

  // The link owner still sees the same anonymous name.
  const ownerAfter = await request(app).get(`/conversation/${conversationId}`).set(auth(owner.token)).expect(200);
  assert.equal(ownerAfter.body.anonymous_pseudo, ownerBefore.body.anonymous_pseudo);

  // Messages now come from the app identity.
  const messages = await request(app).get(`/message/${conversationId}`).set(auth(appUser.token)).expect(200);
  assert.ok(messages.body.every((m) => m.sender_id === appUser.user.id));

  // The app user is no longer capped like a web user.
  for (let i = 0; i < 8; i += 1) {
    await request(app).post('/message').set(auth(appUser.token))
      .send({ conversationId, content: `app ${i}` }).expect(201);
  }
});

test('old web session is dead after transfer and the code cannot be reused', async () => {
  const owner = await init();
  const web = await init('web');
  await writeVia(web, await linkOf(owner), 'hello');
  const code = await transferCode(web);
  await claim(await init('app'), code).expect(200);

  const me = await request(app).get('/identity/me').set(auth(web.token)).expect(401);
  assert.equal(me.body.code, 'IDENTITY_TRANSFERRED');

  const again = await claim(await init('app'), code).expect(409);
  assert.equal(again.body.code, 'TRANSFER_CODE_USED');
});

test('if the app user already talks on the same link, messages are merged', async () => {
  const owner = await init();
  const link = await linkOf(owner);
  const appUser = await init('app');
  const appConversation = await writeVia(appUser, link, 'depuis l app');

  const web = await init('web');
  const webConversation = await writeVia(web, link, 'depuis le web');

  const res = await claim(appUser, await transferCode(web)).expect(200);
  assert.deepEqual(res.body.conversationIds, [appConversation]);

  const gone = await pool.query('SELECT 1 FROM conversations WHERE id = $1', [webConversation]);
  assert.equal(gone.rowCount, 0);

  const messages = await request(app).get(`/message/${appConversation}`).set(auth(appUser.token)).expect(200);
  const contents = messages.body.map((m) => m.content).sort();
  assert.deepEqual(contents, ['depuis l app', 'depuis le web']);
});

test('only the latest code is valid', async () => {
  const web = await init('web');
  const first = await transferCode(web);
  await transferCode(web);
  const res = await claim(await init('app'), first).expect(409);
  assert.equal(res.body.code, 'TRANSFER_CODE_USED');
});

test('an app identity cannot request a transfer code', async () => {
  const appUser = await init('app');
  const res = await request(app)
    .post('/identity/transfer-token')
    .set(auth(appUser.token))
    .expect(400);
  assert.equal(res.body.code, 'NOT_A_WEB_IDENTITY');
});
