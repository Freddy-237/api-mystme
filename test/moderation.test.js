const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const app = require('../src/app');
const env = require('../src/config/env');
const pool = require('../src/config/database');

let identityInitCounter = 0;

async function initIdentity() {
  identityInitCounter += 1;
  const res = await request(app)
    .post('/identity/init')
    .set('x-forwarded-for', `10.0.0.${identityInitCounter}`)
    .expect(201);
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
  assert.equal(reportRes.body.already_reported, false);
  // The reporter gets an acknowledgement only: nothing about the reported user.
  assert.equal(reportRes.body.reported_user_id, undefined);
  assert.ok(!JSON.stringify(reportRes.body).includes(anon.user.id));
});

test('moderation report deduplicates repeated reports from the same reporter', async () => {
  const owner = await initIdentity();
  const anon = await initIdentity();
  const conversationId = await createConversation(owner, anon);

  const firstRes = await authed(
    request(app).post('/moderation/report').send({
      conversationId,
      reason: 'spam',
    }),
    owner,
  ).expect(201);

  const secondRes = await authed(
    request(app).post('/moderation/report').send({
      conversationId,
      reason: 'spam encore',
    }),
    owner,
  ).expect(200);

  assert.equal(secondRes.body.id, firstRes.body.id);
  assert.equal(secondRes.body.already_reported, true);
  // The reporter only gets an acknowledgement: no ids, pseudos or counts.
  assert.equal(secondRes.body.unique_reporter_count, undefined);
  assert.equal(secondRes.body.reported_user_id, undefined);
  assert.equal(secondRes.body.anonymous_id, undefined);
});

test('moderation report auto-flags after threshold of unique reporters', async () => {
  const targetAnon = await initIdentity();
  const owner1 = await initIdentity();
  const owner2 = await initIdentity();
  const owner3 = await initIdentity();

  const conversationId1 = await createConversation(owner1, targetAnon);
  const conversationId2 = await createConversation(owner2, targetAnon);
  const conversationId3 = await createConversation(owner3, targetAnon);

  await authed(
    request(app).post('/moderation/report').send({
      conversationId: conversationId1,
      reason: 'suspicious',
    }),
    owner1,
  ).expect(201);

  await authed(
    request(app).post('/moderation/report').send({
      conversationId: conversationId2,
      reason: 'suspicious',
    }),
    owner2,
  ).expect(201);

  const thirdRes = await authed(
    request(app).post('/moderation/report').send({
      conversationId: conversationId3,
      reason: 'suspicious',
    }),
    owner3,
  ).expect(201);

  assert.equal(thirdRes.body.reported_user_id, undefined);

  const pendingRes = await withModerationAuth(
    request(app).get('/moderation/reports').query({ status: 'pending' }),
  ).expect(200);

  const flaggedReport = pendingRes.body.find((report) => report.id === thirdRes.body.id);
  assert.equal(flaggedReport.auto_flagged, true);
  assert.equal(flaggedReport.unique_reporter_count, 3);
  assert.equal(flaggedReport.reported_user_id, targetAnon.user.id);
  assert.equal(flaggedReport.auto_flag_threshold, 3);

  const meRes = await authed(
    request(app).get('/identity/me'),
    targetAnon,
  ).expect(200);

  assert.equal(meRes.body.system_warning_code, 'moderation-threshold');
  assert.match(meRes.body.system_warning_message, /Avertissement du système/i);
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

test('moderation report without auth returns 401', async () => {
  await request(app)
    .post('/moderation/report')
    .send({ conversationId: 'fake', reason: 'spam' })
    .expect(401);
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