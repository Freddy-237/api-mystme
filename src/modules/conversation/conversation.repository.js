const pool = require('../../config/database');

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

const findById = async (id) => {
  const result = await pool.query('SELECT * FROM conversations WHERE id = $1', [id]);
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

const findByLinkAndAnonymous = async (linkId, anonymousId) => {
  const result = await pool.query(
    'SELECT * FROM conversations WHERE link_id = $1 AND anonymous_id = $2',
    [linkId, anonymousId]
  );
  return result.rows[0];
};

const updateStatus = async (id, status) => {
  const result = await pool.query(
    'UPDATE conversations SET status = $1 WHERE id = $2 RETURNING *',
    [status, id]
  );
  return result.rows[0];
};

const blockConversation = async (id) => {
  const result = await pool.query(
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
       lm.content          AS last_message,
       lm.sender_id        AS last_message_sender_id,
       lm.created_at       AS last_message_at,
       COALESCE(uc.cnt, 0) AS unread_count
     FROM conversations c
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
     WHERE (c.owner_id = $1 OR c.anonymous_id = $1)
       AND c.status NOT IN ('deleted', 'blocked')
     ORDER BY COALESCE(lm.created_at, c.created_at) DESC`,
    [userId]
  );
  return result.rows;
};

const archiveConversation = async (id) => {
  const result = await pool.query(
    "UPDATE conversations SET status = 'archived' WHERE id = $1 RETURNING *",
    [id]
  );
  return result.rows[0];
};

/** Soft-delete a conversation (owner or anonymous can do it). */
const softDeleteConversation = async (id) => {
  const result = await pool.query(
    "UPDATE conversations SET status = 'deleted' WHERE id = $1 RETURNING *",
    [id]
  );
  return result.rows[0];
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
  updateStatus,
  blockConversation,
  archiveConversation,
  softDeleteConversation,
  markConversationRead,
};
