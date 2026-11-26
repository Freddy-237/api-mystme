const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const https = require('https');
const { generateKeyPairSync } = require('crypto');

const receiptService = require('../src/services/receipt.service');
const receiptServicePath = require.resolve('../src/services/receipt.service');
const subscriptionServicePath = require.resolve('../src/modules/subscription/subscription.service');

const setEnv = (t, name, value) => {
  const previous = process.env[name];
  process.env[name] = value;
  t.after(() => {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  });
};

const mockHttpsResponses = (t, responses) => {
  t.mock.method(https, 'request', (options, callback) => {
    const request = new EventEmitter();
    request.write = () => {};
    request.end = () => {
      const next = responses.shift();
      assert.ok(next, `Unexpected HTTPS request to ${options.hostname}${options.path}`);
      process.nextTick(() => {
        const response = new EventEmitter();
        response.statusCode = next.statusCode ?? 200;
        callback(response);
        response.emit('data', JSON.stringify(next.body));
        response.emit('end');
      });
    };
    return request;
  });
};

const appleResponse = (transaction) => ({
  status: 0,
  environment: 'Sandbox',
  latest_receipt_info: transaction ? [transaction] : [],
});

const appleSubscription = (overrides = {}) => ({
  product_id: 'mystme_premium_monthly',
  purchase_date_ms: String(Date.now() - 60_000),
  expires_date_ms: String(Date.now() + 60_000),
  transaction_id: 'apple-transaction',
  ...overrides,
});

const googleCredentials = () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return JSON.stringify({
    client_email: 'receipt-test@example.com',
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  });
};

const loadSubscriptionServiceWithReceiptStubs = (t, stubs) => {
  const receiptModule = require(receiptServicePath);
  const originalApple = receiptModule.verifyAppleReceipt;
  const originalGoogle = receiptModule.verifyGoogleReceipt;

  receiptModule.verifyAppleReceipt = stubs.verifyAppleReceipt || originalApple;
  receiptModule.verifyGoogleReceipt = stubs.verifyGoogleReceipt || originalGoogle;
  delete require.cache[subscriptionServicePath];

  const service = require(subscriptionServicePath);
  t.after(() => {
    receiptModule.verifyAppleReceipt = originalApple;
    receiptModule.verifyGoogleReceipt = originalGoogle;
    delete require.cache[subscriptionServicePath];
  });
  return service;
};

test('Apple rejects a successful response without a matching subscription transaction', async (t) => {
  setEnv(t, 'APPLE_SHARED_SECRET', 'test-secret');
  mockHttpsResponses(t, [{ body: appleResponse(null) }]);

  const receipt = await receiptService.verifyAppleReceipt(
    'receipt',
    'mystme_premium_monthly',
    true,
  );
  assert.equal(receipt.valid, false);
});

test('Apple rejects a transaction for a different product', async (t) => {
  setEnv(t, 'APPLE_SHARED_SECRET', 'test-secret');
  mockHttpsResponses(t, [{
    body: appleResponse(appleSubscription({ product_id: 'unrelated.product' })),
  }]);

  const receipt = await receiptService.verifyAppleReceipt(
    'receipt',
    'mystme_premium_monthly',
    true,
  );
  assert.equal(receipt.valid, false);
});

test('Apple rejects expired subscriptions and accepts a matching active subscription', async (t) => {
  setEnv(t, 'APPLE_SHARED_SECRET', 'test-secret');
  mockHttpsResponses(t, [
    { body: appleResponse(appleSubscription({ expires_date_ms: String(Date.now() - 1) })) },
    { body: appleResponse(appleSubscription()) },
  ]);

  const expired = await receiptService.verifyAppleReceipt(
    'expired-receipt',
    'mystme_premium_monthly',
    true,
  );
  const active = await receiptService.verifyAppleReceipt(
    'active-receipt',
    'mystme_premium_monthly',
    true,
  );
  assert.equal(expired.valid, false);
  assert.equal(active.valid, true);
});

test('Apple validates a matching one-time purchase from the app receipt', async (t) => {
  setEnv(t, 'APPLE_SHARED_SECRET', 'test-secret');
  mockHttpsResponses(t, [{
    body: {
      status: 0,
      receipt: {
        in_app: [{
          product_id: 'mystme_unlock_single',
          purchase_date_ms: String(Date.now() - 60_000),
          transaction_id: 'apple-unlock-transaction',
        }],
      },
    },
  }]);

  const receipt = await receiptService.verifyAppleReceipt(
    'receipt',
    'mystme_unlock_single',
    false,
  );
  assert.equal(receipt.valid, true);
});

test('Google rejects an HTTP error response even when its body is JSON', async (t) => {
  setEnv(t, 'GOOGLE_SERVICE_ACCOUNT', googleCredentials());
  mockHttpsResponses(t, [
    { body: { access_token: 'test-access-token' } },
    { statusCode: 403, body: { error: { message: 'forbidden' } } },
  ]);

  const receipt = await receiptService.verifyGoogleReceipt(
    'purchase-token',
    'mystme_premium_monthly',
    true,
  );
  assert.equal(receipt.valid, false);
});

test('Google accepts an active subscription with a future expiry and acknowledges it', async (t) => {
  setEnv(t, 'GOOGLE_SERVICE_ACCOUNT', googleCredentials());
  const responses = [
    { body: { access_token: 'test-access-token' } },
    { body: { paymentState: 1, acknowledgementState: 0, expiryTimeMillis: String(Date.now() + 60_000) } },
    { body: {} }, // :acknowledge
  ];
  mockHttpsResponses(t, responses);

  const receipt = await receiptService.verifyGoogleReceipt(
    'purchase-token',
    'mystme_premium_monthly',
    true,
  );
  assert.equal(receipt.valid, true);
  assert.equal(receipt.productId, 'mystme_premium_monthly');
  assert.equal(responses.length, 0, 'the purchase must be acknowledged');
  const ackCall = https.request.mock.calls[2].arguments[0];
  assert.equal(ackCall.method, 'POST');
  assert.match(ackCall.path, /purchase-token:acknowledge$/);
});

test('Google does not acknowledge a purchase twice', async (t) => {
  setEnv(t, 'GOOGLE_SERVICE_ACCOUNT', googleCredentials());
  mockHttpsResponses(t, [
    { body: { access_token: 'test-access-token' } },
    { body: { paymentState: 1, acknowledgementState: 1, expiryTimeMillis: String(Date.now() + 60_000) } },
  ]);
  const receipt = await receiptService.verifyGoogleReceipt('purchase-token', 'mystme_premium_monthly', true);
  assert.equal(receipt.valid, true);
});

test('Google rejects missing and expired subscription expirations', async (t) => {
  setEnv(t, 'GOOGLE_SERVICE_ACCOUNT', googleCredentials());
  mockHttpsResponses(t, [
    { body: { access_token: 'test-access-token' } },
    { body: { paymentState: 1 } },
    { body: { access_token: 'test-access-token' } },
    { body: { paymentState: 1, expiryTimeMillis: String(Date.now() - 1) } },
  ]);

  const missingExpiry = await receiptService.verifyGoogleReceipt(
    'purchase-token',
    'mystme_premium_monthly',
    true,
  );
  const expired = await receiptService.verifyGoogleReceipt(
    'purchase-token',
    'mystme_premium_monthly',
    true,
  );
  assert.equal(missingExpiry.valid, false);
  assert.equal(expired.valid, false);
});

test('subscription rejects an unrecognized product before store verification', async (t) => {
  const service = loadSubscriptionServiceWithReceiptStubs(t, {
    verifyGoogleReceipt: async () => assert.fail('Must not verify an unrecognized product'),
  });

  await assert.rejects(
    service.verifySubscription({
      userId: 'user',
      productId: 'unrecognized.product',
      store: 'google',
      purchaseToken: 'token',
    }),
    /Produit abonnement invalide/,
  );
});

test('subscription ignores client expiry and rejects receipts without verified expiry', async (t) => {
  const service = loadSubscriptionServiceWithReceiptStubs(t, {
    verifyGoogleReceipt: async () => ({
      valid: true,
      expiresAt: null,
      productId: 'mystme_premium_monthly',
    }),
  });

  await assert.rejects(
    service.verifySubscription({
      userId: 'user',
      productId: 'mystme_premium_monthly',
      store: 'google',
      purchaseToken: 'token',
      expiresAt: '2099-01-01T00:00:00.000Z',
    }),
    /Reçu invalide/,
  );
});

test('subscription rejects a verified receipt whose product does not match the request', async (t) => {
  const service = loadSubscriptionServiceWithReceiptStubs(t, {
    verifyAppleReceipt: async () => ({
      valid: true,
      expiresAt: new Date(Date.now() + 60_000),
      productId: 'unrelated.product',
    }),
  });

  await assert.rejects(
    service.verifySubscription({
      userId: 'user',
      productId: 'mystme_premium_monthly',
      store: 'apple',
      purchaseToken: 'receipt',
    }),
    /Reçu invalide/,
  );
});

test('single unlock rejects an unrecognized product before checking conversation access', async (t) => {
  const service = loadSubscriptionServiceWithReceiptStubs(t, {
    verifyGoogleReceipt: async () => assert.fail('Must not verify an unrecognized product'),
  });

  await assert.rejects(
    service.verifyUnlock({
      userId: 'user',
      conversationId: 'conversation',
      productId: 'unrecognized.product',
      store: 'google',
      purchaseToken: 'token',
    }),
    /Produit de déblocage invalide/,
  );
});
