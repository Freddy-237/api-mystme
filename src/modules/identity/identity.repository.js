const pool = require('../../config/database');

const createUser = async (user) => {
  const query = `
    INSERT INTO users (id, anonymous_uid, pseudo, avatar_url)
    VALUES ($1, $2, $3, $4)
    RETURNING *;
  `;
  const values = [user.id, user.anonymous_uid, user.pseudo, user.avatar_url];
  const result = await pool.query(query, values);
  return result.rows[0];
};

const findById = async (id) => {
  const result = await pool.query(
    'SELECT id, anonymous_uid, pseudo, avatar_url, bio, email, email_verified_at, last_seen_at, created_at FROM users WHERE id = $1',
    [id]
  );
  return result.rows[0];
};

const findByAnonymousUid = async (anonymousUid) => {
  const result = await pool.query(
    'SELECT id, anonymous_uid, pseudo, avatar_url, bio, email, email_verified_at, last_seen_at, created_at FROM users WHERE anonymous_uid = $1',
    [anonymousUid]
  );
  return result.rows[0];
};

const updateLastSeen = async (id) => {
  await pool.query('UPDATE users SET last_seen_at = NOW() WHERE id = $1', [id]);
};

const updatePseudoAndAvatar = async (id, pseudo, avatarUrl) => {
  const result = await pool.query(
    'UPDATE users SET pseudo = $1, avatar_url = $2 WHERE id = $3 RETURNING *',
    [pseudo, avatarUrl, id]
  );
  return result.rows[0];
};

const updateBio = async (id, bio) => {
  const result = await pool.query(
    'UPDATE users SET bio = $1 WHERE id = $2 RETURNING *',
    [bio, id]
  );
  return result.rows[0];
};

const updatePushToken = async (id, token) => {
  const result = await pool.query(
    'UPDATE users SET push_token = $1, push_updated_at = NOW() WHERE id = $2 RETURNING *',
    [token, id]
  );
  return result.rows[0];
};

const updateRecoveryKeyHash = async (id, recoveryKeyHash) => {
  const result = await pool.query(
    `UPDATE users
       SET recovery_key_hash = $1,
           recovery_key_created_at = NOW()
     WHERE id = $2
     RETURNING *`,
    [recoveryKeyHash, id]
  );
  return result.rows[0];
};

const findByRecoveryKeyHash = async (recoveryKeyHash) => {
  const result = await pool.query(
    `SELECT id, anonymous_uid, pseudo, avatar_url, bio, email, email_verified_at, last_seen_at, created_at
       FROM users
      WHERE recovery_key_hash = $1`,
    [recoveryKeyHash]
  );
  return result.rows[0];
};

const createEmailOtp = async ({ id, userId, email, codeHash, expiresAt }) => {
  await pool.query(
    `INSERT INTO identity_email_otps (id, user_id, email, code_hash, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [id, userId, email, codeHash, expiresAt]
  );
};

const findLatestEmailOtp = async ({ userId, email }) => {
  const result = await pool.query(
    `SELECT id, user_id, email, code_hash, expires_at, consumed_at, created_at
       FROM identity_email_otps
      WHERE user_id = $1
        AND LOWER(email) = LOWER($2)
      ORDER BY created_at DESC
      LIMIT 1`,
    [userId, email]
  );
  return result.rows[0];
};

const consumeEmailOtp = async (otpId) => {
  await pool.query(
    'UPDATE identity_email_otps SET consumed_at = NOW() WHERE id = $1',
    [otpId]
  );
};

const setVerifiedEmail = async ({ userId, email }) => {
  const result = await pool.query(
    `UPDATE users
        SET email = $1,
            email_verified_at = NOW()
      WHERE id = $2
      RETURNING id, anonymous_uid, pseudo, avatar_url, bio, email, email_verified_at, last_seen_at, created_at`,
    [email, userId]
  );
  return result.rows[0];
};

const findByEmail = async (email) => {
  const result = await pool.query(
    `SELECT id, anonymous_uid, pseudo, avatar_url, bio, email, email_verified_at, last_seen_at, created_at
       FROM users
      WHERE LOWER(email) = LOWER($1)
      LIMIT 1`,
    [email]
  );
  return result.rows[0];
};

/**
 * Lookup the latest OTP for a given email, regardless of userId.
 * Used for unauthenticated email-based account restore.
 */
const findLatestEmailOtpByEmail = async (email) => {
  const result = await pool.query(
    `SELECT id, user_id, email, code_hash, expires_at, consumed_at, created_at
       FROM identity_email_otps
      WHERE LOWER(email) = LOWER($1)
      ORDER BY created_at DESC
      LIMIT 1`,
    [email]
  );
  return result.rows[0];
};

module.exports = {
  createUser,
  findById,
  findByAnonymousUid,
  updateLastSeen,
  updatePseudoAndAvatar,
  updateBio,
  updatePushToken,
  updateRecoveryKeyHash,
  findByRecoveryKeyHash,
  createEmailOtp,
  findLatestEmailOtp,
  consumeEmailOtp,
  setVerifiedEmail,
  findByEmail,
  findLatestEmailOtpByEmail,
};
