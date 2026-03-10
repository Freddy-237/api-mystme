const pool = require('../../config/database');
const withTransaction = require('../../utils/withTransaction');

const execute = (queryable, query, values) => queryable.query(query, values);

const createSubscription = async (sub, queryable = pool) => {
  const { rows } = await execute(
    queryable,
    `INSERT INTO subscriptions (id, user_id, product_id, store, purchase_token, status, started_at, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [sub.id, sub.user_id, sub.product_id, sub.store, sub.purchase_token, sub.status || 'active', sub.started_at || new Date(), sub.expires_at],
  );
  return rows[0];
};

const findByPurchaseToken = async (store, purchaseToken, queryable = pool, { forUpdate = false } = {}) => {
  if (!purchaseToken) return null;
  const { rows } = await execute(
    queryable,
    `SELECT * FROM subscriptions
     WHERE store = $1 AND purchase_token = $2
     ORDER BY created_at DESC
     LIMIT 1${forUpdate ? ' FOR UPDATE' : ''}`,
    [store, purchaseToken],
  );
  return rows[0] || null;
};

const findActiveByUser = async (userId, queryable = pool) => {
  const { rows } = await execute(
    queryable,
    `SELECT * FROM subscriptions
     WHERE user_id = $1 AND status = 'active' AND (expires_at IS NULL OR expires_at > NOW())
     ORDER BY created_at DESC LIMIT 1`,
    [userId],
  );
  return rows[0] || null;
};

const updateStatus = async (id, status) => {
  const { rows } = await pool.query(
    `UPDATE subscriptions SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
    [status, id],
  );
  return rows[0];
};

const updateSubscription = async (id, fields, queryable = pool) => {
  const { rows } = await execute(
    queryable,
    `UPDATE subscriptions
     SET product_id = $1,
         status = $2,
         started_at = $3,
         expires_at = $4,
         updated_at = NOW()
     WHERE id = $5
     RETURNING *`,
    [fields.product_id, fields.status, fields.started_at, fields.expires_at, id],
  );
  return rows[0] || null;
};

const createUnlock = async (unlock, queryable = pool) => {
  const { rows } = await execute(
    queryable,
    `INSERT INTO conversation_unlocks (id, user_id, conversation_id, product_id, store, purchase_token)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (user_id, conversation_id) DO NOTHING
     RETURNING *`,
    [unlock.id, unlock.user_id, unlock.conversation_id, unlock.product_id, unlock.store, unlock.purchase_token],
  );
  return rows[0];
};

const findUnlock = async (userId, conversationId, queryable = pool, { forUpdate = false } = {}) => {
  const { rows } = await execute(
    queryable,
    `SELECT * FROM conversation_unlocks WHERE user_id = $1 AND conversation_id = $2${forUpdate ? ' FOR UPDATE' : ''}`,
    [userId, conversationId],
  );
  return rows[0] || null;
};

const findUnlockByPurchaseToken = async (store, purchaseToken, queryable = pool, { forUpdate = false } = {}) => {
  if (!purchaseToken) return null;
  const { rows } = await execute(
    queryable,
    `SELECT * FROM conversation_unlocks
     WHERE store = $1 AND purchase_token = $2
     ORDER BY created_at DESC
     LIMIT 1${forUpdate ? ' FOR UPDATE' : ''}`,
    [store, purchaseToken],
  );
  return rows[0] || null;
};

const updateUserTier = async (userId, tier, queryable = pool) => {
  await execute(
    queryable,
    `UPDATE users SET tier = $1 WHERE id = $2`,
    [tier, userId],
  );
};

const upsertSubscriptionWithUserTier = async (sub, tier) => {
  return withTransaction(async (client) => {
    const existing = await findByPurchaseToken(sub.store, sub.purchase_token, client, { forUpdate: true });

    if (existing) {
      if (existing.user_id !== sub.user_id) {
        return { conflict: existing, subscription: null };
      }

      const updated = await updateSubscription(existing.id, sub, client);
      await updateUserTier(sub.user_id, tier, client);
      return { conflict: null, subscription: updated };
    }

    const created = await createSubscription(sub, client);
    await updateUserTier(sub.user_id, tier, client);
    return { conflict: null, subscription: created };
  });
};

const upsertUnlock = async (unlock) => {
  return withTransaction(async (client) => {
    const existingByToken = await findUnlockByPurchaseToken(unlock.store, unlock.purchase_token, client, { forUpdate: true });
    if (existingByToken) {
      if (
        existingByToken.user_id !== unlock.user_id ||
        existingByToken.conversation_id !== unlock.conversation_id
      ) {
        return { conflict: existingByToken, unlock: null };
      }

      return { conflict: null, unlock: existingByToken };
    }

    const existingByConversation = await findUnlock(unlock.user_id, unlock.conversation_id, client, { forUpdate: true });
    if (existingByConversation) {
      return { conflict: null, unlock: existingByConversation };
    }

    const created = await createUnlock(unlock, client);
    return { conflict: null, unlock: created };
  });
};

module.exports = {
  createSubscription,
  findByPurchaseToken,
  findActiveByUser,
  updateStatus,
  updateSubscription,
  createUnlock,
  findUnlock,
  findUnlockByPurchaseToken,
  updateUserTier,
  upsertSubscriptionWithUserTier,
  upsertUnlock,
};
