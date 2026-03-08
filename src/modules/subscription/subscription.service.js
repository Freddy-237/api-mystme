const { randomUUID: uuidv4 } = require('crypto');
const repo = require('./subscription.repository');
const { verifyAppleReceipt, verifyGoogleReceipt } = require('../../services/receipt.service');
const logger = require('../../utils/logger');
const AppError = require('../../utils/AppError');

/**
 * Product IDs (must match App Store Connect & Google Play Console).
 */
const PRODUCTS = {
  PREMIUM_MONTHLY: 'mystme_premium_monthly',
  UNLOCK_SINGLE: 'mystme_unlock_single',
};

/**
 * Verify a subscription purchase with Apple/Google, then persist it.
 */
const verifySubscription = async ({ userId, productId, store, purchaseToken, expiresAt }) => {
  // Server-to-server receipt validation.
  const receipt = await _validateReceipt(store, purchaseToken, productId, /* isSub */ true);
  if (!receipt.valid) {
    throw new AppError('Reçu invalide', 400);
  }

  const sub = await repo.createSubscription({
    id: uuidv4(),
    user_id: userId,
    product_id: receipt.productId || productId,
    store,
    purchase_token: purchaseToken,
    status: 'active',
    started_at: new Date(),
    expires_at: receipt.expiresAt || (expiresAt ? new Date(expiresAt) : null),
  });

  // Mark user as premium.
  await repo.updateUserTier(userId, 'monthly');
  logger.info({ userId, productId, store }, 'Subscription verified');

  return sub;
};

/**
 * Verify a single-conversation unlock purchase.
 */
const verifyUnlock = async ({ userId, conversationId, productId, store, purchaseToken }) => {
  const receipt = await _validateReceipt(store, purchaseToken, productId || PRODUCTS.UNLOCK_SINGLE, /* isSub */ false);
  if (!receipt.valid) {
    throw new AppError('Reçu invalide', 400);
  }

  const unlock = await repo.createUnlock({
    id: uuidv4(),
    user_id: userId,
    conversation_id: conversationId,
    product_id: productId || PRODUCTS.UNLOCK_SINGLE,
    store,
    purchase_token: purchaseToken,
  });

  logger.info({ userId, conversationId, store }, 'Conversation unlock verified');
  return unlock;
};

/**
 * Check if user has premium (active subscription).
 */
const isPremium = async (userId) => {
  const sub = await repo.findActiveByUser(userId);
  return !!sub;
};

/**
 * Check if a conversation is unlocked for a user (premium OR single-unlock).
 */
const isConversationUnlocked = async (userId, conversationId) => {
  if (await isPremium(userId)) return true;
  const unlock = await repo.findUnlock(userId, conversationId);
  return !!unlock;
};

// ---------------------------------------------------------------------------
// Internal receipt dispatcher
// ---------------------------------------------------------------------------
const VALID_STORES = ['apple', 'google'];

async function _validateReceipt(store, purchaseToken, productId, isSubscription) {
  if (store === 'apple') {
    return verifyAppleReceipt(purchaseToken);
  }
  if (store === 'google') {
    return verifyGoogleReceipt(purchaseToken, productId, isSubscription);
  }
  logger.warn({ store }, 'Unknown store — rejecting receipt');
  return { valid: false, expiresAt: null, productId };
}

module.exports = {
  PRODUCTS,
  verifySubscription,
  verifyUnlock,
  isPremium,
  isConversationUnlocked,
};
