/**
 * Receipt verification for Apple App Store and Google Play.
 *
 * Apple  — App Store Server API v2 (JWT-signed requests).
 *          Fallback: legacy verifyReceipt endpoint.
 * Google — Google Play Developer API v3 (OAuth2 service account).
 *
 * Environment variables required:
 *   APPLE_SHARED_SECRET       — for legacy verifyReceipt
 *   GOOGLE_SERVICE_ACCOUNT    — JSON string of service-account credentials
 *   GOOGLE_PACKAGE_NAME       — e.g. "com.mystme.app"
 */

const https = require('https');
const logger = require('../utils/logger');

// ---------------------------------------------------------------------------
// Apple
// ---------------------------------------------------------------------------

const APPLE_VERIFY_URL = 'https://buy.itunes.apple.com/verifyReceipt';
const APPLE_SANDBOX_URL = 'https://sandbox.itunes.apple.com/verifyReceipt';

/**
 * Verify an Apple receipt.
 * Returns { valid, expiresAt, productId, environment }.
 */
const verifyAppleReceipt = async (receiptData, expectedProductId, isSubscription = true) => {
  const secret = process.env.APPLE_SHARED_SECRET;
  if (!secret) {
    logger.error('[receipt] APPLE_SHARED_SECRET not set — rejecting receipt');
    return { valid: false, expiresAt: null, productId: null, environment: 'unknown' };
  }
  if (!expectedProductId) {
    return { valid: false, expiresAt: null, productId: null, environment: 'unknown' };
  }

  const body = JSON.stringify({
    'receipt-data': receiptData,
    password: secret,
    'exclude-old-transactions': true,
  });

  const result = await _postJson(APPLE_VERIFY_URL, body);

  // Status 21007 → receipt is from sandbox; retry against sandbox.
  if (result.status === 21007) {
    const sandboxResult = await _postJson(APPLE_SANDBOX_URL, body);
    return _parseAppleResponse(sandboxResult, expectedProductId, isSubscription);
  }

  return _parseAppleResponse(result, expectedProductId, isSubscription);
};

function _parseAppleResponse(json, expectedProductId, isSubscription) {
  if (!json || json.status !== 0 || !expectedProductId) {
    logger.warn({ status: json?.status }, '[receipt] Apple verification failed');
    return { valid: false, expiresAt: null, productId: null, environment: json?.environment };
  }

  const transactions = isSubscription
    ? (Array.isArray(json.latest_receipt_info) ? json.latest_receipt_info : [])
    : [
        ...(Array.isArray(json.receipt?.in_app) ? json.receipt.in_app : []),
        ...(Array.isArray(json.latest_receipt_info) ? json.latest_receipt_info : []),
      ];
  const matchingTransactions = transactions.filter((transaction) => {
    const purchasedAt = Number(transaction?.purchase_date_ms);
    return (
      transaction?.product_id === expectedProductId &&
      Number.isFinite(purchasedAt) &&
      purchasedAt > 0 &&
      !transaction.cancellation_date_ms &&
      !transaction.cancellation_date &&
      !transaction.revocation_date_ms &&
      !transaction.revocation_date
    );
  });

  if (isSubscription) {
    const activeTransactions = matchingTransactions
      .map((transaction) => ({
        transaction,
        expiry: Number(transaction.expires_date_ms),
      }))
      .filter(({ expiry }) => Number.isFinite(expiry) && expiry > Date.now())
      .sort((a, b) => b.expiry - a.expiry);
    const latest = activeTransactions[0];
    if (!latest) {
      return { valid: false, expiresAt: null, productId: null, environment: json.environment };
    }

    return {
      valid: true,
      expiresAt: new Date(latest.expiry),
      productId: latest.transaction.product_id,
      environment: json.environment,
    };
  }

  return {
    valid: matchingTransactions.length > 0,
    expiresAt: null,
    productId: matchingTransactions.length > 0 ? expectedProductId : null,
    environment: json.environment,
  };
}

// ---------------------------------------------------------------------------
// Google
// ---------------------------------------------------------------------------

/**
 * Verify a Google Play purchase.
 * Returns { valid, expiresAt, productId }.
 */
const verifyGoogleReceipt = async (purchaseToken, productId, isSubscription = true) => {
  const credsJson = process.env.GOOGLE_SERVICE_ACCOUNT;
  const packageName = process.env.GOOGLE_PACKAGE_NAME || 'com.mystme.app';

  if (!credsJson) {
    logger.error('[receipt] GOOGLE_SERVICE_ACCOUNT not set — rejecting receipt');
    return { valid: false, expiresAt: null, productId };
  }

  let creds;
  try {
    creds = JSON.parse(credsJson);
  } catch {
    logger.error('[receipt] Invalid GOOGLE_SERVICE_ACCOUNT JSON');
    return { valid: false, expiresAt: null, productId };
  }

  // Obtain OAuth2 access token via service-account JWT.
  const accessToken = await _getGoogleAccessToken(creds);
  if (!accessToken) {
    return { valid: false, expiresAt: null, productId };
  }

  const resource = isSubscription ? 'subscriptions' : 'products';
  const url =
    `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/` +
    `${encodeURIComponent(packageName)}/purchases/${resource}/` +
    `${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}`;

  const result = await _getJson(url, accessToken);
  if (!result) {
    return { valid: false, expiresAt: null, productId };
  }

  if (isSubscription) {
    const expiryMillis = Number(result.expiryTimeMillis);
    const expiresAt = Number.isFinite(expiryMillis) && expiryMillis > 0
      ? new Date(expiryMillis)
      : null;
    // cancelReason only means auto-renew is off: access runs until expiry
    // (on refund/revoke Google moves the expiry into the past).
    const pendingPayment = result.paymentState != null &&
      ![1, 2].includes(Number(result.paymentState));
    const valid = !pendingPayment && expiresAt && expiresAt.getTime() > Date.now();
    return { valid: !!valid, expiresAt: valid ? expiresAt : null, productId };
  }

  // Consumable: purchaseState 0 = purchased.
  return { valid: result.purchaseState === 0, expiresAt: null, productId };
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _postJson(url, body) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.request(
      {
        hostname: parsed.hostname,
        path: parsed.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`Apple verification HTTP ${res.statusCode}`));
            return;
          }
          try {
            resolve(JSON.parse(data));
          } catch {
            reject(new Error('Invalid JSON from Apple'));
          }
        });
      },
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function _getJson(url, bearerToken) {
  return new Promise((resolve) => {
    const parsed = new URL(url);
    const req = https.request(
      {
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        method: 'GET',
        headers: { Authorization: `Bearer ${bearerToken}` },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            logger.warn({ statusCode: res.statusCode }, '[receipt] Google verification rejected');
            resolve(null);
            return;
          }
          try {
            const json = JSON.parse(data);
            resolve(json && typeof json === 'object' && !Array.isArray(json) ? json : null);
          } catch {
            logger.error('[receipt] Invalid JSON from Google');
            resolve(null);
          }
        });
      },
    );
    req.on('error', (err) => {
      logger.error({ err }, '[receipt] Google API request failed');
      resolve(null);
    });
    req.end();
  });
}

/**
 * Obtain an OAuth2 access token from a Google service-account credential.
 * Uses a self-signed JWT (urn:ietf:params:oauth:grant-type:jwt-bearer).
 */
async function _getGoogleAccessToken(creds) {
  const crypto = require('crypto');

  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const claimSet = Buffer.from(
    JSON.stringify({
      iss: creds.client_email,
      scope: 'https://www.googleapis.com/auth/androidpublisher',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    }),
  ).toString('base64url');

  const signInput = `${header}.${claimSet}`;
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(signInput);
  const signature = sign.sign(creds.private_key, 'base64url');
  const jwt = `${signInput}.${signature}`;

  const body = `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${jwt}`;

  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: 'oauth2.googleapis.com',
        path: '/token',
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            resolve(json.access_token || null);
          } catch {
            resolve(null);
          }
        });
      },
    );
    req.on('error', () => resolve(null));
    req.write(body);
    req.end();
  });
}

module.exports = {
  verifyAppleReceipt,
  verifyGoogleReceipt,
};
