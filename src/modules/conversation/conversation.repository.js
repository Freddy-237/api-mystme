const pool = require('../../config/database');
const {
  CONVERSATION_EXPIRY_SQL_INTERVAL,
} = require('./conversation.expiry');

const baseConversationSelect = `
  SELECT c.*,
         CASE
           WHEN c.started_at IS NULL THEN NULL
           ELSE c.started_at + ${CONVERSATION_EXPIRY_SQL_INTERVAL}
         END AS expires_at,
         ou.pseudo AS owner_pseudo,
         au.pseudo AS anonymous_pseudo
  FROM conversations c
  LEFT JOIN users ou ON ou.id = c.owner_id
  LEFT JOIN users au ON au.id = c.anonymous_id
`;

const execute = (queryable, query, values) => {
  return queryable.query(query, values);
};

const createConversation = async (conv) => {
  const query = `
    INSERT INTO conversations (id, owner_id, anonymous_id, link_id)
    VALUES ($1, $2, $3, $4)
    RETURNING *;
  `;
  const values = [conv.id, conv.owner_id, conv.anonymous_id, conv.link_id];
  const result = await pool.query(query, values);
  return result.rows[0];
};

const findById = async (id, queryable = pool) => {
  const result = await execute(
    queryable,
    `${baseConversationSelect}
     WHERE c.id = $1`,
    [id]
  );
  return result.rows[0];
};

const findByParticipant = async (userId) => {
  const result = await pool.query(
    `SELECT * FROM conversations
     WHERE owner_id = $1 OR anonymous_id = $1
     ORDER BY started_at DESC`,
    [userId]
  );
  return result.rows;
};

const findByLinkAndAnonymous = async (linkId, anonymousId, queryable = pool) => {
  const result = await execute(
    queryable,
    'SELECT * FROM conversations WHERE link_id = $1 AND anonymous_id = $2',
    [linkId, anonymousId]
  );
  return result.rows[0];
};

const isParticipant = async (conversationId, userId, queryable = pool) => {
  const result = await execute(
    queryable,
    'SELECT 1 FROM conversations WHERE id = $1 AND (owner_id = $2 OR anonymous_id = $2)',
    [conversationId, userId],
  );
  return result.rows.length > 0;
};

const hasSharedConversation = async (userId, otherUserId, queryable = pool) => {
  const result = await execute(
    queryable,
    `SELECT 1
     FROM conversations
     WHERE status != 'blocked'
       AND ((owner_id = $1 AND anonymous_id = $2) OR (owner_id = $2 AND anonymous_id = $1))
     LIMIT 1`,
    [userId, otherUserId],
  );
  return result.rows.length > 0;
};

/**
 * Reactivate visibility for one or more users on a conversation.
 * This is used when an existing conversation is reopened from an invite link.
 */
const reactivateForUsers = async (conversationId, userIds, queryable = pool) => {
  const ids = Array.from(new Set((userIds || []).filter(Boolean)));
  if (ids.length === 0) return;

  await execute(
    queryable,
    `INSERT INTO conversation_user_status (conversation_id, user_id, status, updated_at)
     SELECT $1, uid, 'active', NOW()
     FROM UNNEST($2::uuid[]) AS uid
     ON CONFLICT (conversation_id, user_id)
     DO UPDATE SET status = 'active', updated_at = NOW()`,
    [conversationId, ids]
  );
};

const findOrCreateByLinkAndAnonymous = async ({ id, link_id, owner_id, anonymous_id }) => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))',
      [String(link_id), String(anonymous_id)],
    );

    const existing = await findByLinkAndAnonymous(link_id, anonymous_id, client);
    if (existing) {
      await reactivateForUsers(existing.id, [owner_id, anonymous_id], client);
      await client.query('COMMIT');
      return {
        conversation: await findById(existing.id),
        created: false,
      };
    }

    const result = await client.query(
      `INSERT INTO conversations (id, owner_id, anonymous_id, link_id)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [id, owner_id, anonymous_id, link_id],
    );
    const conversationId = result.rows[0].id;

    await reactivateForUsers(conversationId, [owner_id, anonymous_id], client);
    await client.query('COMMIT');

    return {
      conversation: await findById(conversationId),
      created: true,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const updateStatus = async (id, status, queryable = pool) => {
  const result = await execute(
    queryable,
    'UPDATE conversations SET status = $1 WHERE id = $2 RETURNING *',
    [status, id]
  );
  return result.rows[0];
};

const blockConversation = async (id, queryable = pool) => {
  const result = await execute(
    queryable,
    "UPDATE conversations SET status = 'blocked', blocked_at = NOW() WHERE id = $1 RETURNING *",
    [id]
  );
  return result.rows[0];
};

/**
 * Get conversations for a user with last message + unread count.
 */
const findByParticipantWithUnread = async (userId) => {
  const result = await pool.query(
    `SELECT
       c.*,
       CASE
         WHEN c.started_at IS NULL THEN NULL
         ELSE c.started_at + ${CONVERSATION_EXPIRY_SQL_INTERVAL}
       END               AS expires_at,
       lm.content          AS last_message,
       lm.sender_id        AS last_message_sender_id,
       lm.created_at       AS last_message_at,
       COALESCE(uc.cnt, 0) AS unread_count,
       ou.pseudo            AS owner_pseudo,
       au.pseudo            AS anonymous_pseudo
     FROM conversations c
     LEFT JOIN users ou ON ou.id = c.owner_id
     LEFT JOIN users au ON au.id = c.anonymous_id
     LEFT JOIN LATERAL (
       SELECT content, sender_id, created_at
       FROM messages
       WHERE conversation_id = c.id AND is_deleted = FALSE
       ORDER BY created_at DESC
       LIMIT 1
     ) lm ON TRUE
     LEFT JOIN LATERAL (
       SELECT COUNT(*) AS cnt
       FROM messages
       WHERE conversation_id = c.id
         AND is_deleted = FALSE
         AND is_read = FALSE
         AND sender_id != $1
     ) uc ON TRUE
     LEFT JOIN conversation_user_status cus
       ON cus.conversation_id = c.id AND cus.user_id = $1
     WHERE (c.owner_id = $1 OR c.anonymous_id = $1)
       AND c.status NOT IN ('deleted', 'blocked')
       AND COALESCE(cus.status, 'active') NOT IN ('deleted', 'archived')
     ORDER BY COALESCE(lm.created_at, c.created_at) DESC`,
    [userId]
  );
  return result.rows;
};

const archiveConversation = async (id, userId) => {
  await pool.query(
    `INSERT INTO conversation_user_status (conversation_id, user_id, status, updated_at)
     VALUES ($1, $2, 'archived', NOW())
     ON CONFLICT (conversation_id, user_id)
     DO UPDATE SET status = 'archived', updated_at = NOW()`,
    [id, userId]
  );
  return { id, status: 'archived' };
};

/** Soft-delete a conversation for the calling user only. */
const softDeleteConversation = async (id, userId) => {
  await pool.query(
    `INSERT INTO conversation_user_status (conversation_id, user_id, status, updated_at)
     VALUES ($1, $2, 'deleted', NOW())
     ON CONFLICT (conversation_id, user_id)
     DO UPDATE SET status = 'deleted', updated_at = NOW()`,
    [id, userId]
  );
  return { id, status: 'deleted' };
};

/** Set started_at to NOW() if not already set (first message trigger). */
const setStartedAt = async (id, queryable = pool) => {
  const result = await execute(
    queryable,
    `UPDATE conversations SET started_at = NOW()
     WHERE id = $1 AND started_at IS NULL
     RETURNING *`,
    [id]
  );
  return result.rows[0]; // undefined if already set
};

/** Mark all messages in a conversation as read for a given recipient. */
const markConversationRead = async (conversationId, recipientId) => {
  await pool.query(
    `UPDATE messages
     SET is_read = TRUE, read_at = NOW()
     WHERE conversation_id = $1
       AND sender_id != $2
       AND is_read = FALSE`,
    [conversationId, recipientId]
  );
};

module.exports = {
  createConversation,
  findById,
  findByParticipant,
  findByParticipantWithUnread,
  findByLinkAndAnonymous,
  findOrCreateByLinkAndAnonymous,
  isParticipant,
  hasSharedConversation,
  reactivateForUsers,
  updateStatus,
  blockConversation,
  archiveConversation,
  softDeleteConversation,
  markConversationRead,
  setStartedAt,
};
