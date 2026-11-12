const { randomUUID: uuidv4 } = require('crypto');
const repo = require('./subscription.repository');
const { verifyAppleReceipt, verifyGoogleReceipt } = require('../../services/receipt.service');
const logger = require('../../utils/logger');
const AppError = require('../../utils/AppError');
const conversationRepository = require('../conversation/conversation.repository');

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
const verifySubscription = async ({ userId, productId, store, purchaseToken }) => {
  if (productId !== PRODUCTS.PREMIUM_MONTHLY) {
    throw new AppError('Produit abonnement invalide', 400);
  }

  // Server-to-server receipt validation.
  const receipt = await _validateReceipt(store, purchaseToken, productId, /* isSub */ true);
  if (!_isReceiptValidForProduct(receipt, productId, true)) {
    throw new AppError('Reçu invalide', 400);
  }

  const { subscription, conflict } = await repo.upsertSubscriptionWithUserTier({
    id: uuidv4(),
    user_id: userId,
    product_id: productId,
    store,
    purchase_token: purchaseToken,
    status: 'active',
    started_at: new Date(),
    expires_at: new Date(receipt.expiresAt),
  }, 'monthly');
  if (conflict) {
    throw new AppError('Ce reçu est déjà associé à un autre compte', 409);
  }

  logger.info({ userId, productId, store }, 'Subscription verified');

  return subscription;
};

/**
 * Verify a single-conversation unlock purchase.
 */
const verifyUnlock = async ({ userId, conversationId, productId, store, purchaseToken }) => {
  const expectedProductId = productId || PRODUCTS.UNLOCK_SINGLE;
  if (expectedProductId !== PRODUCTS.UNLOCK_SINGLE) {
    throw new AppError('Produit de déblocage invalide', 400);
  }

  const allowed = await conversationRepository.isParticipant(conversationId, userId);
  if (!allowed) {
    throw new AppError('Non autorisé', 403);
  }

  const receipt = await _validateReceipt(store, purchaseToken, expectedProductId, /* isSub */ false);
  if (!_isReceiptValidForProduct(receipt, expectedProductId, false)) {
    throw new AppError('Reçu invalide', 400);
  }

  const { unlock, conflict } = await repo.upsertUnlock({
    id: uuidv4(),
    user_id: userId,
    conversation_id: conversationId,
    product_id: expectedProductId,
    store,
    purchase_token: purchaseToken,
  });
  if (conflict) {
    throw new AppError('Ce reçu est déjà utilisé pour une autre conversation', 409);
  }

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
    return verifyAppleReceipt(purchaseToken, productId, isSubscription);
  }
  if (store === 'google') {
    return verifyGoogleReceipt(purchaseToken, productId, isSubscription);
  }
  logger.warn({ store }, 'Unknown store — rejecting receipt');
  return { valid: false, expiresAt: null, productId };
}

function _isReceiptValidForProduct(receipt, productId, isSubscription) {
  if (!receipt?.valid || receipt.productId !== productId) return false;
  if (!isSubscription) return true;

  const expiresAt = new Date(receipt.expiresAt).getTime();
  return Number.isFinite(expiresAt) && expiresAt > Date.now();
}

module.exports = {
  PRODUCTS,
  verifySubscription,
  verifyUnlock,
  isPremium,
  isConversationUnlocked,
};
