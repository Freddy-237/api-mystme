const subscriptionService = require('./subscription.service');

/**
 * POST /subscription/verify
 * Body: { productId, store, purchaseToken, expiresAt? }
 */
const verifySubscription = async (req, res, next) => {
  try {
    const { productId, store, purchaseToken, expiresAt } = req.body;
    if (!productId || !store || !purchaseToken) {
      return res.status(400).json({ message: 'productId, store et purchaseToken requis' });
    }
    if (!['apple', 'google'].includes(store)) {
      return res.status(400).json({ message: 'store doit être apple ou google' });
    }

    const sub = await subscriptionService.verifySubscription({
      userId: req.user.id,
      productId,
      store,
      purchaseToken,
      expiresAt,
    });
    res.status(201).json(sub);
  } catch (error) {
    next(error);
  }
};

/**
 * POST /subscription/unlock
 * Body: { conversationId, productId, store, purchaseToken }
 */
const verifyUnlock = async (req, res, next) => {
  try {
    const { conversationId, productId, store, purchaseToken } = req.body;
    if (!conversationId || !store || !purchaseToken) {
      return res.status(400).json({ message: 'conversationId, store et purchaseToken requis' });
    }

    const unlock = await subscriptionService.verifyUnlock({
      userId: req.user.id,
      conversationId,
      productId: productId || subscriptionService.PRODUCTS.UNLOCK_SINGLE,
      store,
      purchaseToken,
    });
    res.status(201).json(unlock);
  } catch (error) {
    next(error);
  }
};

/**
 * GET /subscription/status
 */
const getStatus = async (req, res, next) => {
  try {
    const premium = await subscriptionService.isPremium(req.user.id);
    res.json({ premium });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /subscription/unlock/:conversationId
 */
const getUnlockStatus = async (req, res, next) => {
  try {
    const unlocked = await subscriptionService.isConversationUnlocked(
      req.user.id,
      req.params.conversationId,
    );
    res.json({ unlocked });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  verifySubscription,
  verifyUnlock,
  getStatus,
  getUnlockStatus,
};
