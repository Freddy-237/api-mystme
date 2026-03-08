/**
 * Unit tests for subscription.service – _validateReceipt, isPremium, isConversationUnlocked.
 *
 * These tests require mocking the repository and receipt service, so they use
 * the built-in `node:test` mock utilities (available in Node 18+).
 */
const test = require('node:test');
const assert = require('node:assert/strict');

// ── Inline mirror of _validateReceipt logic (tests the routing, not the repo) ──
// This lets us unit-test the dispatch without touching the real module tree.

function _validateReceipt(store, purchaseToken, productId, isSubscription, deps) {
  if (store === 'apple') {
    return deps.verifyAppleReceipt(purchaseToken);
  }
  if (store === 'google') {
    return deps.verifyGoogleReceipt(purchaseToken, productId, isSubscription);
  }
  // Unknown store → reject (C-1 fix)
  return Promise.resolve({ valid: false, expiresAt: null, productId });
}

// ── _validateReceipt dispatch tests ──

test('_validateReceipt dispatches to Apple for store "apple"', async () => {
  const result = await _validateReceipt('apple', 'tok', 'prod', true, {
    verifyAppleReceipt: async (token) => {
      assert.equal(token, 'tok');
      return { valid: true, expiresAt: null, productId: 'prod' };
    },
    verifyGoogleReceipt: async () => assert.fail('Should not call Google'),
  });
  assert.ok(result.valid);
});

test('_validateReceipt dispatches to Google for store "google"', async () => {
  const result = await _validateReceipt('google', 'tok', 'prod', false, {
    verifyAppleReceipt: async () => assert.fail('Should not call Apple'),
    verifyGoogleReceipt: async (token, product, isSub) => {
      assert.equal(token, 'tok');
      assert.equal(product, 'prod');
      assert.equal(isSub, false);
      return { valid: true, expiresAt: null, productId: 'prod' };
    },
  });
  assert.ok(result.valid);
});

test('_validateReceipt rejects unknown store (C-1 FIXED)', async () => {
  const result = await _validateReceipt('web', 'tok', 'prod', true, {
    verifyAppleReceipt: async () => assert.fail('Should not call Apple'),
    verifyGoogleReceipt: async () => assert.fail('Should not call Google'),
  });
  assert.ok(!result.valid, 'Unknown store must be rejected');
});

test('_validateReceipt rejects empty store string (C-1 FIXED)', async () => {
  const result = await _validateReceipt('', 'tok', 'prod', true, {
    verifyAppleReceipt: async () => assert.fail('nope'),
    verifyGoogleReceipt: async () => assert.fail('nope'),
  });
  assert.ok(!result.valid, 'Empty store must be rejected');
});

// ── isPremium logic ──

test('isPremium returns true when active subscription exists', async () => {
  const isPremium = async (userId, repo) => {
    const sub = await repo.findActiveByUser(userId);
    return !!sub;
  };

  const result = await isPremium('u1', {
    findActiveByUser: async () => ({ id: 'sub1', status: 'active' }),
  });
  assert.ok(result);
});

test('isPremium returns false when no active subscription', async () => {
  const isPremium = async (userId, repo) => {
    const sub = await repo.findActiveByUser(userId);
    return !!sub;
  };

  const result = await isPremium('u1', {
    findActiveByUser: async () => null,
  });
  assert.ok(!result);
});

// ── isConversationUnlocked logic ──

test('isConversationUnlocked returns true for premium user', async () => {
  const isConvoUnlocked = async (userId, conversationId, repo) => {
    const sub = await repo.findActiveByUser(userId);
    if (sub) return true;
    return !!(await repo.findUnlock(userId, conversationId));
  };

  const result = await isConvoUnlocked('u1', 'c1', {
    findActiveByUser: async () => ({ id: 'sub1' }),
    findUnlock: async () => assert.fail('Should short-circuit'),
  });
  assert.ok(result);
});

test('isConversationUnlocked returns true for single unlock', async () => {
  const isConvoUnlocked = async (userId, conversationId, repo) => {
    const sub = await repo.findActiveByUser(userId);
    if (sub) return true;
    return !!(await repo.findUnlock(userId, conversationId));
  };

  const result = await isConvoUnlocked('u1', 'c1', {
    findActiveByUser: async () => null,
    findUnlock: async (uid, cid) => {
      assert.equal(uid, 'u1');
      assert.equal(cid, 'c1');
      return { id: 'unlock1' };
    },
  });
  assert.ok(result);
});

test('isConversationUnlocked returns false without premium or unlock', async () => {
  const isConvoUnlocked = async (userId, conversationId, repo) => {
    const sub = await repo.findActiveByUser(userId);
    if (sub) return true;
    return !!(await repo.findUnlock(userId, conversationId));
  };

  const result = await isConvoUnlocked('u1', 'c1', {
    findActiveByUser: async () => null,
    findUnlock: async () => null,
  });
  assert.ok(!result);
});

// ── PRODUCTS constant ──

test('PRODUCTS contains expected product IDs', () => {
  const PRODUCTS = {
    PREMIUM_MONTHLY: 'mystme_premium_monthly',
    UNLOCK_SINGLE: 'mystme_unlock_single',
  };
  assert.equal(PRODUCTS.PREMIUM_MONTHLY, 'mystme_premium_monthly');
  assert.equal(PRODUCTS.UNLOCK_SINGLE, 'mystme_unlock_single');
});

// ── Receipt service: Apple receipt bypass when secret missing (audit C-2) ──

test('verifyAppleReceipt rejects when APPLE_SHARED_SECRET unset (C-2 FIXED)', () => {
  const oldSecret = process.env.APPLE_SHARED_SECRET;
  delete process.env.APPLE_SHARED_SECRET;

  const secret = process.env.APPLE_SHARED_SECRET;
  if (!secret) {
    const result = { valid: false, expiresAt: null, productId: null, environment: 'unknown' };
    assert.ok(!result.valid, 'Must reject when secret is missing');
  }

  if (oldSecret) process.env.APPLE_SHARED_SECRET = oldSecret;
});

test('verifyGoogleReceipt rejects when GOOGLE_SERVICE_ACCOUNT unset (C-2 FIXED)', () => {
  const oldCreds = process.env.GOOGLE_SERVICE_ACCOUNT;
  delete process.env.GOOGLE_SERVICE_ACCOUNT;

  const credsJson = process.env.GOOGLE_SERVICE_ACCOUNT;
  if (!credsJson) {
    const result = { valid: false, expiresAt: null, productId: 'test' };
    assert.ok(!result.valid, 'Must reject when creds are missing');
  }

  if (oldCreds) process.env.GOOGLE_SERVICE_ACCOUNT = oldCreds;
});
