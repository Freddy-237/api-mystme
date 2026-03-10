const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { randomUUID } = require('crypto');

const app = require('../src/app');
const env = require('../src/config/env');

const receiptServicePath = require.resolve('../src/services/receipt.service');
const subscriptionServicePath = require.resolve('../src/modules/subscription/subscription.service');

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

function loadSubscriptionServiceWithStubs(stubs) {
  const receiptService = require(receiptServicePath);
  const originalApple = receiptService.verifyAppleReceipt;
  const originalGoogle = receiptService.verifyGoogleReceipt;

  receiptService.verifyAppleReceipt = stubs.verifyAppleReceipt || originalApple;
  receiptService.verifyGoogleReceipt = stubs.verifyGoogleReceipt || originalGoogle;

  delete require.cache[subscriptionServicePath];
  const subscriptionService = require(subscriptionServicePath);

  return {
    subscriptionService,
    restore() {
      receiptService.verifyAppleReceipt = originalApple;
      receiptService.verifyGoogleReceipt = originalGoogle;
      delete require.cache[subscriptionServicePath];
    },
  };
}

test('verifySubscription is idempotent for the same user and purchase token', async () => {
  const user = await initIdentity();
  const purchaseToken = `sub-token-idempotent-${randomUUID()}`;
  const { subscriptionService, restore } = loadSubscriptionServiceWithStubs({
    verifyGoogleReceipt: async () => ({
      valid: true,
      expiresAt: new Date('2030-01-01T00:00:00.000Z'),
      productId: 'mystme_premium_monthly',
    }),
  });

  try {
    const first = await subscriptionService.verifySubscription({
      userId: user.user.id,
      productId: 'mystme_premium_monthly',
      store: 'google',
      purchaseToken,
    });
    const second = await subscriptionService.verifySubscription({
      userId: user.user.id,
      productId: 'mystme_premium_monthly',
      store: 'google',
      purchaseToken,
    });

    assert.equal(second.id, first.id);
    assert.equal(second.user_id, user.user.id);
  } finally {
    restore();
  }
});

test('verifySubscription rejects purchase token reuse across accounts', async () => {
  const userA = await initIdentity();
  const userB = await initIdentity();
  const purchaseToken = `sub-token-conflict-${randomUUID()}`;
  const { subscriptionService, restore } = loadSubscriptionServiceWithStubs({
    verifyGoogleReceipt: async () => ({
      valid: true,
      expiresAt: new Date('2030-01-01T00:00:00.000Z'),
      productId: 'mystme_premium_monthly',
    }),
  });

  try {
    await subscriptionService.verifySubscription({
      userId: userA.user.id,
      productId: 'mystme_premium_monthly',
      store: 'google',
      purchaseToken,
    });

    await assert.rejects(
      () => subscriptionService.verifySubscription({
        userId: userB.user.id,
        productId: 'mystme_premium_monthly',
        store: 'google',
        purchaseToken,
      }),
      /déjà associé à un autre compte/i,
    );
  } finally {
    restore();
  }
});

test('verifyUnlock is idempotent for the same conversation and purchase token', async () => {
  const owner = await initIdentity();
  const anon = await initIdentity();
  const conversationId = await createConversation(owner, anon);
  const purchaseToken = `unlock-token-idempotent-${randomUUID()}`;
  const { subscriptionService, restore } = loadSubscriptionServiceWithStubs({
    verifyGoogleReceipt: async () => ({
      valid: true,
      expiresAt: null,
      productId: 'mystme_unlock_single',
    }),
  });

  try {
    const first = await subscriptionService.verifyUnlock({
      userId: anon.user.id,
      conversationId,
      productId: 'mystme_unlock_single',
      store: 'google',
      purchaseToken,
    });
    const second = await subscriptionService.verifyUnlock({
      userId: anon.user.id,
      conversationId,
      productId: 'mystme_unlock_single',
      store: 'google',
      purchaseToken,
    });

    assert.equal(second.id, first.id);
    assert.equal(second.conversation_id, conversationId);
  } finally {
    restore();
  }
});

test('verifyUnlock rejects purchase token reuse on another conversation', async () => {
  const owner1 = await initIdentity();
  const owner2 = await initIdentity();
  const anon = await initIdentity();
  const conversationId1 = await createConversation(owner1, anon);
  const conversationId2 = await createConversation(owner2, anon);
  const purchaseToken = `unlock-token-conflict-${randomUUID()}`;
  const { subscriptionService, restore } = loadSubscriptionServiceWithStubs({
    verifyGoogleReceipt: async () => ({
      valid: true,
      expiresAt: null,
      productId: 'mystme_unlock_single',
    }),
  });

  try {
    await subscriptionService.verifyUnlock({
      userId: anon.user.id,
      conversationId: conversationId1,
      productId: 'mystme_unlock_single',
      store: 'google',
      purchaseToken,
    });

    await assert.rejects(
      () => subscriptionService.verifyUnlock({
        userId: anon.user.id,
        conversationId: conversationId2,
        productId: 'mystme_unlock_single',
        store: 'google',
        purchaseToken,
      }),
      /déjà utilisé pour une autre conversation/i,
    );
  } finally {
    restore();
  }
});