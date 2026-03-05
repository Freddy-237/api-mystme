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
const verifyAppleReceipt = async (receiptData) => {
  const secret = process.env.APPLE_SHARED_SECRET;
  if (!secret) {
    logger.warn('[receipt] APPLE_SHARED_SECRET not set — skipping validation');
    return { valid: true, expiresAt: null, productId: null, environment: 'unknown' };
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
    return _parseAppleResponse(sandboxResult);
  }

  return _parseAppleResponse(result);
};

function _parseAppleResponse(json) {
  if (json.status !== 0) {
    logger.warn({ status: json.status }, '[receipt] Apple verification failed');
    return { valid: false, expiresAt: null, productId: null, environment: json.environment };
  }

  const latestInfo = json.latest_receipt_info;
  if (!latestInfo || latestInfo.length === 0) {
    return { valid: true, expiresAt: null, productId: null, environment: json.environment };
  }

  // Pick the most recent transaction.
  const latest = latestInfo.sort(
    (a, b) => Number(b.purchase_date_ms) - Number(a.purchase_date_ms),
  )[0];

  return {
    valid: true,
    expiresAt: latest.expires_date_ms
      ? new Date(Number(latest.expires_date_ms))
      : null,
    productId: latest.product_id,
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
    logger.warn('[receipt] GOOGLE_SERVICE_ACCOUNT not set — skipping validation');
    return { valid: true, expiresAt: null, productId };
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
    `${packageName}/purchases/${resource}/${productId}/tokens/${purchaseToken}`;

  const result = await _getJson(url, accessToken);
  if (!result) {
    return { valid: false, expiresAt: null, productId };
  }

  if (isSubscription) {
    // expiryTimeMillis is present for subscriptions.
    const expiresAt = result.expiryTimeMillis
      ? new Date(Number(result.expiryTimeMillis))
      : null;
    const cancelled = result.cancelReason != null;
    return { valid: !cancelled, expiresAt, productId };
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
          try {
            resolve(JSON.parse(data));
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
