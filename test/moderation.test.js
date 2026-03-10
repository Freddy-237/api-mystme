const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const app = require('../src/app');
const env = require('../src/config/env');
const pool = require('../src/config/database');

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
    .set('Cookie', authCookie)
    .set(env.csrfHeaderName || 'x-csrf-token', csrfToken);
}

function withModerationAuth(req, actor = 'qa-reviewer') {
  return req
    .set('x-moderation-api-key', env.moderationApiKey)
    .set('x-moderation-actor', actor);
}

async function createConversation(ownerAuth, anonAuth) {
  const linkRes = await request(app)
    .post('/link')
    .set('Authorization', `Bearer ${ownerAuth.token}`)
    .expect(201);

  const resolveRes = await authed(
    request(app).post('/conversation/resolve-link').send({ inviteCode: linkRes.body.code }),
    anonAuth,
  ).expect(200);

  return resolveRes.body.conversationId;
}

test('moderation report accepts a message from the same conversation', async () => {
  const owner = await initIdentity();
  const anon = await initIdentity();
  const conversationId = await createConversation(owner, anon);

  const messageRes = await authed(
    request(app).post('/message').send({ conversationId, content: 'Signal me' }),
    anon,
  ).expect(201);

  const reportRes = await authed(
    request(app).post('/moderation/report').send({
      conversationId,
      messageId: messageRes.body.id,
      reason: 'spam',
    }),
    owner,
  ).expect(201);

  assert.equal(reportRes.body.conversation_id, conversationId);
  assert.equal(reportRes.body.message_id, messageRes.body.id);
});

test('moderation report rejects a message from another conversation', async () => {
  const owner1 = await initIdentity();
  const anon1 = await initIdentity();
  const owner2 = await initIdentity();
  const anon2 = await initIdentity();

  const conversationId1 = await createConversation(owner1, anon1);
  const conversationId2 = await createConversation(owner2, anon2);

  const messageRes = await authed(
    request(app).post('/message').send({ conversationId: conversationId2, content: 'Wrong conversation' }),
    anon2,
  ).expect(201);

  const reportRes = await authed(
    request(app).post('/moderation/report').send({
      conversationId: conversationId1,
      messageId: messageRes.body.id,
      reason: 'invalid',
    }),
    owner1,
  );

  assert.equal(reportRes.status, 400);
  assert.equal(reportRes.body.message, 'Message de signalement invalide');
});

test('moderation reports listing requires internal moderation auth', async () => {
  await request(app).get('/moderation/reports').expect(401);
});

test('moderation review can dismiss a report', async () => {
  const owner = await initIdentity();
  const anon = await initIdentity();
  const conversationId = await createConversation(owner, anon);

  const reportRes = await authed(
    request(app).post('/moderation/report').send({
      conversationId,
      reason: 'benign',
    }),
    owner,
  ).expect(201);

  const pendingRes = await withModerationAuth(
    request(app).get('/moderation/reports').query({ status: 'pending' }),
  ).expect(200);

  assert.ok(pendingRes.body.some((report) => report.id === reportRes.body.id));

  const reviewRes = await withModerationAuth(
    request(app)
      .post(`/moderation/report/${reportRes.body.id}/review`)
      .send({ decision: 'dismissed', note: 'false positive' }),
    'ops-dismiss',
  ).expect(200);

  assert.equal(reviewRes.body.status, 'dismissed');
  assert.equal(reviewRes.body.reviewed_by, 'ops-dismiss');
  assert.equal(reviewRes.body.decision_note, 'false positive');
});

test('moderation review can hide a message, block conversation and ban reported user', async () => {
  const owner = await initIdentity();
  const anon = await initIdentity();
  const conversationId = await createConversation(owner, anon);

  const messageRes = await authed(
    request(app).post('/message').send({ conversationId, content: 'abusive content' }),
    anon,
  ).expect(201);

  const reportRes = await authed(
    request(app).post('/moderation/report').send({
      conversationId,
      messageId: messageRes.body.id,
      reason: 'abuse',
    }),
    owner,
  ).expect(201);

  const reviewRes = await withModerationAuth(
    request(app)
      .post(`/moderation/report/${reportRes.body.id}/review`)
      .send({
        decision: 'reviewed',
        note: 'confirmed abuse',
        hideMessage: true,
        blockConversation: true,
        banUser: true,
        banReason: 'Abusive behavior',
      }),
    'ops-ban',
  ).expect(200);

  assert.equal(reviewRes.body.status, 'reviewed');
  assert.equal(reviewRes.body.reviewed_by, 'ops-ban');

  const messageState = await pool.query('SELECT is_deleted FROM messages WHERE id = $1', [messageRes.body.id]);
  assert.equal(messageState.rows[0].is_deleted, true);

  const conversationState = await pool.query('SELECT status FROM conversations WHERE id = $1', [conversationId]);
  assert.equal(conversationState.rows[0].status, 'blocked');

  const bannedUserState = await pool.query(
    'SELECT is_banned, ban_reason FROM users WHERE id = $1',
    [anon.user.id],
  );
  assert.equal(bannedUserState.rows[0].is_banned, true);
  assert.equal(bannedUserState.rows[0].ban_reason, 'Abusive behavior');

  await request(app)
    .post('/identity/session-token')
    .set('Cookie', anon.authCookie)
    .expect(403);

  await authed(
    request(app).post('/message').send({ conversationId, content: 'still posting' }),
    owner,
  ).expect(403);
});