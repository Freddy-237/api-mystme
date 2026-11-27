const pool = require('../../config/database');

const execute = (queryable, query, values) => queryable.query(query, values);

// Columns safe to return from write queries. Never `RETURNING *`: it would
// leak recovery_key_hash, push_token, ban/tier internals to clients.
const PUBLIC_RETURNING = `
  RETURNING id, anonymous_uid, pseudo, avatar_url, bio, email, email_verified_at,
            notifications_enabled, origin, web_expires_at, last_seen_at, created_at
`;

const baseUserSelect = `
  SELECT
    id,
    anonymous_uid,
    pseudo,
    avatar_url,
    bio,
    to_jsonb(users)->>'email' AS email,
    (to_jsonb(users)->>'email_verified_at')::timestamp AS email_verified_at,
    to_jsonb(users)->>'push_token' AS push_token,
    COALESCE((to_jsonb(users)->>'notifications_enabled')::boolean, TRUE) AS notifications_enabled,
    origin,
    web_expires_at,
    last_seen_at,
    created_at
  FROM users
`;

const createUser = async (user) => {
  const query = `
    INSERT INTO users (id, anonymous_uid, pseudo, avatar_url, origin, web_expires_at)
    VALUES ($1, $2, $3, $4, $5, $6)
    ${PUBLIC_RETURNING};
  `;
  const values = [
    user.id,
    user.anonymous_uid,
    user.pseudo,
    user.avatar_url,
    user.origin || 'app',
    user.web_expires_at || null,
  ];
  const result = await pool.query(query, values);
  return result.rows[0];
};

const findById = async (id) => {
  const result = await pool.query(
    `${baseUserSelect} WHERE id = $1`,
    [id]
  );
  return result.rows[0];
};

const findAuthStateById = async (id, queryable = pool) => {
  const result = await execute(
    queryable,
    `SELECT id, is_banned, ban_reason, banned_at, merged_into_user_id, session_version
       FROM users
      WHERE id = $1`,
    [id],
  );
  return result.rows[0];
};

/** Minimal state needed to decide whether a user may write. */
const findAccessStateById = async (id, queryable = pool) => {
  const result = await execute(
    queryable,
    `SELECT id, origin, web_expires_at, is_banned
       FROM users
      WHERE id = $1`,
    [id],
  );
  return result.rows[0];
};

const updateBanState = async (id, { isBanned, reason }, queryable = pool) => {
  const result = await execute(
    queryable,
    `UPDATE users
        SET is_banned = $1,
            ban_reason = CASE WHEN $1 THEN $2 ELSE NULL END,
            banned_at = CASE WHEN $1 THEN NOW() ELSE NULL END
      WHERE id = $3
      RETURNING id, is_banned, ban_reason, banned_at`,
    [isBanned, reason || null, id],
  );
  // A banned account's invite link goes dead: nobody can open a new
  // conversation with it. After an unban the user simply creates a new link.
  if (isBanned) {
    await execute(queryable, 'UPDATE links SET is_active = FALSE WHERE owner_id = $1 AND is_active', [id]);
  }
  return result.rows[0];
};

/** Invalidate every token issued so far for this user. */
const bumpSessionVersion = async (id, queryable = pool) => {
  const result = await execute(
    queryable,
    `UPDATE users SET session_version = session_version + 1
      WHERE id = $1
      RETURNING session_version`,
    [id],
  );
  return result.rows[0]?.session_version ?? null;
};

/**
 * Permanently erase an account (must run inside a transaction).
 *
 * Removes the user, the web identities merged into it, every conversation
 * they took part in (as link owner or as anonymous correspondent) with all
 * its messages, and — through ON DELETE CASCADE — their links, reports,
 * recovery/OTP/transfer codes, subscriptions and per-user states.
 *
 * Returns what the caller still has to clean up outside the database.
 */
const deleteAccountData = async (client, userId, { webOnly = false } = {}) => {
  if (webOnly) {
    // Purge job safety net: re-check under lock that this is still a web identity.
    const { rows } = await client.query(
      "SELECT 1 FROM users WHERE id = $1 AND origin = 'web' FOR UPDATE",
      [userId],
    );
    if (rows.length === 0) return null;
  }
  const { rows: userRows } = await client.query(
    `SELECT id FROM users
      WHERE id = $1 OR merged_into_user_id = $1
      FOR UPDATE`,
    [userId],
  );
  const userIds = userRows.map((row) => row.id);
  if (!userIds.includes(userId)) return null;

  const { rows: conversations } = await client.query(
    `SELECT id, owner_id, anonymous_id
       FROM conversations
      WHERE owner_id = ANY($1::uuid[]) OR anonymous_id = ANY($1::uuid[])
      FOR UPDATE`,
    [userIds],
  );
  const conversationIds = conversations.map((row) => row.id);

  const { rows: media } = await client.query(
    `SELECT media_url, media_type
       FROM messages
      WHERE conversation_id = ANY($1::uuid[]) AND media_url IS NOT NULL`,
    [conversationIds],
  );

  await client.query('DELETE FROM conversations WHERE id = ANY($1::uuid[])', [conversationIds]);
  await client.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [userIds]);

  const peers = [];
  for (const conv of conversations) {
    const peerId = userIds.includes(conv.owner_id) ? conv.anonymous_id : conv.owner_id;
    if (peerId && !userIds.includes(peerId)) peers.push({ userId: peerId, conversationId: conv.id });
  }

  return { userIds, conversationIds, media, peers };
};

/** Web identities whose read-only period is over (oldest first). */
const findPurgeableWebIdentityIds = async (lockDays, limit = 200, queryable = pool) => {
  const result = await execute(
    queryable,
    `SELECT id
       FROM users
      WHERE origin = 'web'
        AND web_expires_at IS NOT NULL
        AND web_expires_at < NOW() - ($1 * INTERVAL '1 day')
      ORDER BY web_expires_at
      LIMIT $2`,
    [lockDays, limit],
  );
  return result.rows.map((row) => row.id);
};

const findByAnonymousUid = async (anonymousUid) => {
  const result = await pool.query(
    `${baseUserSelect} WHERE anonymous_uid = $1`,
    [anonymousUid]
  );
  return result.rows[0];
};

const updateLastSeen = async (id) => {
  await pool.query('UPDATE users SET last_seen_at = NOW() WHERE id = $1', [id]);
};

const updatePseudoAndAvatar = async (id, pseudo, avatarUrl) => {
  const result = await pool.query(
    `UPDATE users SET pseudo = $1, avatar_url = $2 WHERE id = $3 ${PUBLIC_RETURNING}`,
    [pseudo, avatarUrl, id]
  );
  return result.rows[0];
};

const updateBio = async (id, bio) => {
  const result = await pool.query(
    `UPDATE users SET bio = $1 WHERE id = $2 ${PUBLIC_RETURNING}`,
    [bio, id]
  );
  return result.rows[0];
};

const updateNotificationPreference = async (id, enabled) => {
  const result = await pool.query(
    `UPDATE users
        SET notifications_enabled = $1,
            push_token = CASE WHEN $1 THEN push_token ELSE NULL END,
            push_updated_at = CASE WHEN $1 THEN push_updated_at ELSE NOW() END
      WHERE id = $2
      ${PUBLIC_RETURNING}`,
    [enabled, id]
  );
  return result.rows[0];
};

const updatePushToken = async (id, token) => {
  const result = await pool.query(
    `UPDATE users SET push_token = $1, push_updated_at = NOW() WHERE id = $2 ${PUBLIC_RETURNING}`,
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
     RETURNING id`,
    [recoveryKeyHash, id]
  );
  return result.rows[0];
};

const findByRecoveryKeyHash = async (recoveryKeyHash) => {
  const result = await pool.query(
    `${baseUserSelect}
      WHERE recovery_key_hash = $1`,
    [recoveryKeyHash]
  );
  return result.rows[0];
};

const OTP_SELECT = `
  SELECT id, user_id, email, code_hash, expires_at, consumed_at, created_at,
         failed_attempts, purpose
    FROM identity_email_otps
`;

const createEmailOtp = async ({ id, userId, email, codeHash, expiresAt, purpose = 'link' }) => {
  await pool.query(
    `INSERT INTO identity_email_otps (id, user_id, email, code_hash, expires_at, purpose)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, userId, email, codeHash, expiresAt, purpose]
  );
};

const findLatestEmailOtp = async ({ userId, email }) => {
  const result = await pool.query(
    `${OTP_SELECT}
      WHERE user_id = $1
        AND LOWER(email) = LOWER($2)
        AND purpose = 'link'
      ORDER BY created_at DESC
      LIMIT 1`,
    [userId, email]
  );
  return result.rows[0];
};

/**
 * Atomically consume an OTP. Returns false if it was already consumed
 * (protects against two concurrent verifications of the same code).
 */
const consumeEmailOtp = async (otpId) => {
  const result = await pool.query(
    `UPDATE identity_email_otps
        SET consumed_at = NOW()
      WHERE id = $1 AND consumed_at IS NULL
      RETURNING id`,
    [otpId]
  );
  return result.rowCount > 0;
};

/**
 * Record a wrong guess. Once maxAttempts is reached the code is burned
 * (consumed_at set) so it can no longer be brute-forced.
 * Returns the updated failed_attempts count.
 */
const registerFailedOtpAttempt = async (otpId, maxAttempts) => {
  const result = await pool.query(
    `UPDATE identity_email_otps
        SET failed_attempts = failed_attempts + 1,
            consumed_at = CASE
              WHEN failed_attempts + 1 >= $2 THEN COALESCE(consumed_at, NOW())
              ELSE consumed_at
            END
      WHERE id = $1
      RETURNING failed_attempts`,
    [otpId, maxAttempts]
  );
  return Number(result.rows[0]?.failed_attempts || 0);
};

const setVerifiedEmail = async ({ userId, email }) => {
  const result = await pool.query(
    `UPDATE users
        SET email = $1,
            email_verified_at = NOW()
      WHERE id = $2
      ${PUBLIC_RETURNING}`,
    [email, userId]
  );
  return result.rows[0];
};

const findByEmail = async (email) => {
  const result = await pool.query(
    `${baseUserSelect}
      WHERE LOWER(email) = LOWER($1)
      LIMIT 1`,
    [email]
  );
  return result.rows[0];
};

/**
 * Lookup the latest *restore* OTP for a given email, regardless of userId.
 * Used for unauthenticated email-based account restore.
 */
const findLatestEmailOtpByEmail = async (email) => {
  const result = await pool.query(
    `${OTP_SELECT}
      WHERE LOWER(email) = LOWER($1)
        AND purpose = 'restore'
      ORDER BY created_at DESC
      LIMIT 1`,
    [email]
  );
  return result.rows[0];
};

module.exports = {
  createUser,
  findById,
  findAuthStateById,
  findAccessStateById,
  updateBanState,
  bumpSessionVersion,
  deleteAccountData,
  findPurgeableWebIdentityIds,
  findByAnonymousUid,
  updateLastSeen,
  updatePseudoAndAvatar,
  updateBio,
  updateNotificationPreference,
  updatePushToken,
  updateRecoveryKeyHash,
  findByRecoveryKeyHash,
  createEmailOtp,
  findLatestEmailOtp,
  consumeEmailOtp,
  registerFailedOtpAttempt,
  setVerifiedEmail,
  findByEmail,
  findLatestEmailOtpByEmail,
};
