const pool = require('../../config/database');

const createSubscription = async (sub) => {
  const { rows } = await pool.query(
    `INSERT INTO subscriptions (id, user_id, product_id, store, purchase_token, status, started_at, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [sub.id, sub.user_id, sub.product_id, sub.store, sub.purchase_token, sub.status || 'active', sub.started_at || new Date(), sub.expires_at],
  );
  return rows[0];
};

const findActiveByUser = async (userId) => {
  const { rows } = await pool.query(
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

const createUnlock = async (unlock) => {
  const { rows } = await pool.query(
    `INSERT INTO conversation_unlocks (id, user_id, conversation_id, product_id, store, purchase_token)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (user_id, conversation_id) DO NOTHING
     RETURNING *`,
    [unlock.id, unlock.user_id, unlock.conversation_id, unlock.product_id, unlock.store, unlock.purchase_token],
  );
  return rows[0];
};

const findUnlock = async (userId, conversationId) => {
  const { rows } = await pool.query(
    `SELECT * FROM conversation_unlocks WHERE user_id = $1 AND conversation_id = $2`,
    [userId, conversationId],
  );
  return rows[0] || null;
};

const updateUserTier = async (userId, tier) => {
  await pool.query(
    `UPDATE users SET tier = $1 WHERE id = $2`,
    [tier, userId],
  );
};

module.exports = {
  createSubscription,
  findActiveByUser,
  updateStatus,
  createUnlock,
  findUnlock,
  updateUserTier,
};
