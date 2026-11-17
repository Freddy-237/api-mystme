// Regression tests for the critical security fixes (no database required).
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const express = require('express');
const request = require('supertest');

const identityRepository = require('../src/modules/identity/identity.repository');
const identityService = require('../src/modules/identity/identity.service');
const { getDefaultKey } = require('../src/middlewares/rateLimit.middleware');
const authMiddleware = require('../src/middlewares/auth.middleware');
const mediaPolicy = require('../src/utils/mediaPolicy');

const hash = (v) => crypto.createHash('sha256').update(v).digest('hex');

// Replace repository functions for one test, restore afterwards.
const stubRepo = (t, overrides) => {
  for (const [name, impl] of Object.entries(overrides)) {
    const original = identityRepository[name];
    identityRepository[name] = impl;
    t.after(() => { identityRepository[name] = original; });
  }
};

const makeOtp = (email, code, extra = {}) => ({
  id: 'otp-1',
  user_id: 'user-1',
  email,
  code_hash: hash(`${email}:${code}`),
  expires_at: new Date(Date.now() + 60_000).toISOString(),
  consumed_at: null,
  failed_attempts: 0,
  purpose: 'restore',
  ...extra,
});

// ── Rate-limit key cannot be spoofed via X-Forwarded-For ──────────────────
test('rate-limit key ignores client-controlled leftmost X-Forwarded-For entries', async () => {
  const app = express();
  app.set('trust proxy', 1);
  app.get('/', (req, res) => res.json({ key: getDefaultKey(req) }));

  const res = await request(app)
    .get('/')
    .set('x-forwarded-for', '6.6.6.6, 7.7.7.7');

  // 6.6.6.6 is forged by the client; 7.7.7.7 was appended by the trusted proxy.
  assert.equal(res.body.key, '7.7.7.7');
});

// ── Auth middleware exposes a machine-readable code ───────────────────────
test('invalid bearer token answers 401 with code AUTH_INVALID', async () => {
  const app = express();
  app.get('/p', authMiddleware, (_req, res) => res.json({ ok: true }));
  const res = await request(app).get('/p').set('Authorization', 'Bearer not-a-jwt');
  assert.equal(res.status, 401);
  assert.equal(res.body.code, 'AUTH_INVALID');
});

test('missing token answers 401 with code AUTH_REQUIRED', async () => {
  const app = express();
  app.get('/p', authMiddleware, (_req, res) => res.json({ ok: true }));
  const res = await request(app).get('/p');
  assert.equal(res.status, 401);
  assert.equal(res.body.code, 'AUTH_REQUIRED');
});

// ── OTP brute-force protection ────────────────────────────────────────────
test('wrong OTP is a 400 (not 401) and is counted', async (t) => {
  const email = 'a@example.com';
  let failedCalls = 0;
  stubRepo(t, {
    findLatestEmailOtpByEmail: async () => makeOtp(email, '123456'),
    registerFailedOtpAttempt: async () => { failedCalls += 1; return 1; },
    consumeEmailOtp: async () => { throw new Error('must not consume on wrong code'); },
  });

  await assert.rejects(
    identityService.verifyEmailRestore(email, '000000'),
    (err) => err.statusCode === 400 && /invalide/.test(err.message),
  );
  assert.equal(failedCalls, 1);
});

test('OTP is burned after the max number of wrong attempts', async (t) => {
  const email = 'b@example.com';
  stubRepo(t, {
    findLatestEmailOtpByEmail: async () => makeOtp(email, '123456', {
      failed_attempts: identityService.OTP_MAX_ATTEMPTS - 1,
    }),
    registerFailedOtpAttempt: async () => identityService.OTP_MAX_ATTEMPTS,
  });

  await assert.rejects(
    identityService.verifyEmailRestore(email, '000000'),
    (err) => err.statusCode === 429,
  );
});

test('a locked OTP stays locked even with the right code', async (t) => {
  const email = 'c@example.com';
  stubRepo(t, {
    findLatestEmailOtpByEmail: async () => makeOtp(email, '123456', {
      failed_attempts: identityService.OTP_MAX_ATTEMPTS,
    }),
    consumeEmailOtp: async () => { throw new Error('must not consume a locked code'); },
  });

  await assert.rejects(
    identityService.verifyEmailRestore(email, '123456'),
    (err) => err.statusCode === 429,
  );
});

test('concurrent use of the same OTP is rejected (atomic consume)', async (t) => {
  const email = 'd@example.com';
  stubRepo(t, {
    findLatestEmailOtpByEmail: async () => makeOtp(email, '123456'),
    consumeEmailOtp: async () => false, // another request consumed it first
  });

  await assert.rejects(
    identityService.verifyEmailRestore(email, '123456'),
    (err) => err.statusCode === 409,
  );
});

test('missing OTP answers like a wrong code (no account enumeration)', async (t) => {
  stubRepo(t, { findLatestEmailOtpByEmail: async () => undefined });
  await assert.rejects(
    identityService.verifyEmailRestore('nobody@example.com', '123456'),
    (err) => err.statusCode === 400,
  );
});

test('restore OTP request gives the same answer for unknown emails', async (t) => {
  let created = false;
  stubRepo(t, {
    findByEmail: async () => undefined,
    createEmailOtp: async () => { created = true; },
  });

  const res = await identityService.requestEmailRestore('unknown@example.com');
  assert.equal(res.ok, true);
  assert.equal(res.delivery, 'sent');
  assert.equal(created, false);
});

test('banned account cannot restore via email even with the right code', async (t) => {
  const email = 'e@example.com';
  stubRepo(t, {
    findLatestEmailOtpByEmail: async () => makeOtp(email, '123456'),
    consumeEmailOtp: async () => true,
    findByEmail: async () => ({ id: 'user-1', email }),
    findAuthStateById: async () => ({ id: 'user-1', is_banned: true }),
  });

  await assert.rejects(
    identityService.verifyEmailRestore(email, '123456'),
    (err) => err.statusCode === 403,
  );
});

test('successful restore returns only public user fields', async (t) => {
  const email = 'f@example.com';
  stubRepo(t, {
    findLatestEmailOtpByEmail: async () => makeOtp(email, '123456'),
    consumeEmailOtp: async () => true,
    findByEmail: async () => ({
      id: 'user-1',
      email,
      pseudo: 'Ghost',
      push_token: 'secret-device-token',
      recovery_key_hash: 'secret-hash',
      is_banned: false,
      tier: 'free',
    }),
    findAuthStateById: async () => ({ id: 'user-1', is_banned: false }),
    updateLastSeen: async () => {},
  });

  const { user, token } = await identityService.verifyEmailRestore(email, '123456');
  assert.equal(typeof token, 'string');
  assert.equal(user.pseudo, 'Ghost');
  for (const leaked of ['push_token', 'recovery_key_hash', 'is_banned', 'tier']) {
    assert.equal(user[leaked], undefined, `${leaked} must not be exposed`);
  }
});

// ── Upload policy ─────────────────────────────────────────────────────────
test('upload policy refuses script-capable formats', () => {
  assert.equal(mediaPolicy.isAllowedImage({ mimetype: 'image/svg+xml' }), false);
  assert.equal(mediaPolicy.isAllowedFile({ mimetype: 'text/html', originalname: 'x.pdf' }), false);
  assert.equal(mediaPolicy.isAllowedFile({ mimetype: 'application/octet-stream', originalname: 'page.html' }), false);
  assert.equal(mediaPolicy.isAllowedFile({ mimetype: 'application/x-msdownload', originalname: 'setup.exe' }), false);
  assert.equal(mediaPolicy.isAllowedSocketMedia('image', 'logo.svg'), false);
  assert.equal(mediaPolicy.isAllowedSocketMedia('file', 'archive.zip'), false);
});

test('upload policy accepts normal media and documents', () => {
  assert.equal(mediaPolicy.isAllowedImage({ mimetype: 'image/jpeg' }), true);
  assert.equal(mediaPolicy.isAllowedVideo({ mimetype: 'video/mp4' }), true);
  assert.equal(mediaPolicy.isAllowedAudio({ mimetype: 'audio/webm;codecs=opus' }), true);
  assert.equal(mediaPolicy.isAllowedFile({ mimetype: 'application/pdf', originalname: 'cv.PDF' }), true);
  assert.equal(mediaPolicy.isAllowedSocketMedia('file', 'notes.docx'), true);
  assert.equal(mediaPolicy.isAllowedSocketMedia('audio', 'voice.m4a'), true);
});

// ── Upload happens only after authorization ───────────────────────────────
test('media upload is not sent to Cloudinary when the user cannot write', async (t) => {
  const cloudinary = require('../src/config/cloudinary');
  const messageService = require('../src/modules/message/message.service');
  const messageController = require('../src/modules/message/message.controller');
  const AppError = require('../src/utils/AppError');

  let uploads = 0;
  const originalUpload = cloudinary.uploader.upload_stream;
  cloudinary.uploader.upload_stream = () => { uploads += 1; return { end() {} }; };
  const originalAssert = messageService.assertConversationWritable;
  messageService.assertConversationWritable = async () => { throw new AppError('Non autorisé', 403); };
  t.after(() => {
    cloudinary.uploader.upload_stream = originalUpload;
    messageService.assertConversationWritable = originalAssert;
  });

  let forwardedError = null;
  await messageController.sendImage(
    {
      body: { conversationId: '00000000-0000-4000-8000-000000000000' },
      file: { buffer: Buffer.from([1]), mimetype: 'image/png', originalname: 'a.png', size: 1 },
      user: { id: 'intruder' },
    },
    { status() { return this; }, json() { return this; } },
    (err) => { forwardedError = err; },
  );

  assert.equal(uploads, 0, 'nothing must reach Cloudinary');
  assert.equal(forwardedError?.statusCode, 403);
});
