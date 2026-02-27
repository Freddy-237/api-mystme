const pool = require('../../config/database');

const createMessage = async (msg) => {
  const query = `
    INSERT INTO messages (id, conversation_id, sender_id, content, media_url, media_type)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *;
  `;
  const values = [
    msg.id,
    msg.conversation_id,
    msg.sender_id,
    msg.content,
    msg.media_url ?? null,
    msg.media_type ?? null,
  ];
  const result = await pool.query(query, values);
  return result.rows[0];
};

const findByConversation = async (conversationId, limit = 50, offset = 0) => {
  const result = await pool.query(
    `SELECT * FROM messages
     WHERE conversation_id = $1 AND is_deleted = FALSE
     ORDER BY created_at DESC
     LIMIT $2 OFFSET $3`,
    [conversationId, limit, offset]
  );
  return result.rows;
};

const findById = async (messageId) => {
  const result = await pool.query(
    'SELECT * FROM messages WHERE id = $1',
    [messageId]
  );
  return result.rows[0];
};

const softDelete = async (messageId) => {
  const result = await pool.query(
    'UPDATE messages SET is_deleted = TRUE WHERE id = $1 RETURNING *',
    [messageId]
  );
  return result.rows[0];
};

/** Mark all messages in a conversation as read for a specific recipient. */
const markRead = async (conversationId, recipientId) => {
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
  createMessage,
  findByConversation,
  findById,
  softDelete,
  markRead,
};
