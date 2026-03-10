const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const app = require('../src/app');
const env = require('../src/config/env');

// ── helpers ──

async function initIdentity() {
  const res = await request(app).post('/identity/init').expect(201);
  const setCookie = res.headers['set-cookie'] || [];
  const authCookie =
    (setCookie.find((h) => h.startsWith(`${env.authCookieName}=`)) || '').split(';')[0];
  const csrfCookie =
    (setCookie.find((h) => h.startsWith(`${env.csrfCookieName}=`)) || '').split(';')[0];
  const csrfToken = csrfCookie.split('=')[1];
  return { token: res.body.token, user: res.body.user, authCookie, csrfToken };
}

function authed(req, { token, authCookie, csrfToken }) {
  return req
    .set('Authorization', `Bearer ${token}`)
    .set('Cookie', `${authCookie}`)
    .set(env.csrfHeaderName || 'x-csrf-token', csrfToken);
}

async function createConversation(ownerAuth, anonAuth) {
  // Owner creates a link
  const linkRes = await request(app)
    .post('/link')
    .set('Authorization', `Bearer ${ownerAuth.token}`)
    .expect(201);

  const inviteCode = linkRes.body.code;

  // Anon resolves the link → creates conversation
  const resolveRes = await authed(
    request(app).post('/conversation/resolve-link').send({ inviteCode }),
    anonAuth,
  ).expect(200);

  return resolveRes.body.conversationId;
}

// ── Message CRUD ──

test('send a text message and retrieve it', async () => {
  const owner = await initIdentity();
  const anon = await initIdentity();
  const conversationId = await createConversation(owner, anon);

  // Send message as anon
  const sendRes = await authed(
    request(app).post('/message').send({ conversationId, content: 'Hello!' }),
    anon,
  );
  assert.equal(sendRes.status, 201);
  assert.equal(sendRes.body.content, 'Hello!');
  assert.equal(sendRes.body.conversation_id, conversationId);
  const messageId = sendRes.body.id;

  // Retrieve messages
  const getRes = await request(app)
    .get(`/message/${conversationId}`)
    .set('Authorization', `Bearer ${anon.token}`)
    .expect(200);

  assert.ok(Array.isArray(getRes.body));
  assert.ok(getRes.body.some((m) => m.id === messageId));
});

test('send message without auth returns 401', async () => {
  await request(app)
    .post('/message')
    .send({ conversationId: 'fake', content: 'Nope' })
    .expect(401);
});

test('send message with empty content returns 400', async () => {
  const owner = await initIdentity();
  const anon = await initIdentity();
  const conversationId = await createConversation(owner, anon);

  const res = await authed(
    request(app).post('/message').send({ conversationId, content: '' }),
    anon,
  );
  assert.equal(res.status, 400);
});

test('delete a message soft-deletes it', async () => {
  const owner = await initIdentity();
  const anon = await initIdentity();
  const conversationId = await createConversation(owner, anon);

  const sendRes = await authed(
    request(app).post('/message').send({ conversationId, content: 'To delete' }),
    anon,
  ).expect(201);

  const messageId = sendRes.body.id;

  const delRes = await authed(
    request(app).delete(`/message/${messageId}`),
    anon,
  );
  assert.equal(delRes.status, 200);
  assert.equal(delRes.body.is_deleted, true);
});

test('reply-to message stores reply metadata', async () => {
  const owner = await initIdentity();
  const anon = await initIdentity();
  const conversationId = await createConversation(owner, anon);

  const first = await authed(
    request(app).post('/message').send({ conversationId, content: 'Original' }),
    owner,
  ).expect(201);

  const reply = await authed(
    request(app).post('/message').send({
      conversationId,
      content: 'Reply',
      replyToMessageId: first.body.id,
    }),
    anon,
  ).expect(201);

  assert.equal(reply.body.reply_to_message_id, first.body.id);
});

// ── Subscription endpoints (without real receipt) ──

test('subscription status without auth returns 401', async () => {
  await request(app).get('/subscription/status').expect(401);
});

test('subscription verify rejects missing fields', async () => {
  const user = await initIdentity();
  const res = await authed(
    request(app).post('/subscription/verify').send({}),
    user,
  );
  assert.equal(res.status, 400);
});

// ── Conversations ──

test('get conversations lists the user conversations', async () => {
  const owner = await initIdentity();
  const anon = await initIdentity();
  await createConversation(owner, anon);

  const res = await request(app)
    .get('/conversation/mine')
    .set('Authorization', `Bearer ${owner.token}`)
    .expect(200);

  assert.ok(Array.isArray(res.body));
  assert.ok(res.body.length >= 1);
});

test('archive a conversation hides it from /conversation/mine', async () => {
  const owner = await initIdentity();
  const anon = await initIdentity();
  const conversationId = await createConversation(owner, anon);

  // Archive
  const archRes = await authed(
    request(app).post(`/conversation/${conversationId}/archive`),
    owner,
  );
  assert.equal(archRes.status, 200);

  const mineRes = await request(app)
    .get('/conversation/mine')
    .set('Authorization', `Bearer ${owner.token}`)
    .expect(200);

  const archivedStillVisible = (mineRes.body || []).some(
    (c) => c.id === conversationId,
  );
  assert.equal(archivedStillVisible, false);
});
