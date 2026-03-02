const pool = require('../../config/database');

const baseSelect = `
  SELECT
    m.*,
    rm.content AS reply_to_content,
    rm.sender_id AS reply_to_sender_id
  FROM messages m
  LEFT JOIN messages rm ON rm.id = m.reply_to_message_id
`;

const createMessage = async (msg) => {
  const query = `
    INSERT INTO messages (id, conversation_id, sender_id, content, media_url, media_type, reply_to_message_id)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING id;
  `;
  const values = [
    msg.id,
    msg.conversation_id,
    msg.sender_id,
    msg.content,
    msg.media_url ?? null,
    msg.media_type ?? null,
    msg.reply_to_message_id ?? null,
  ];
  await pool.query(query, values);
  return findById(msg.id);
};

const findByConversation = async (
  conversationId,
  viewerId,
  limit = 50,
  offset = 0
) => {
  const result = await pool.query(
    `${baseSelect}
     LEFT JOIN hidden_messages hm
       ON hm.message_id = m.id
      AND hm.user_id = $2
     WHERE m.conversation_id = $1
       AND m.is_deleted = FALSE
       AND hm.message_id IS NULL
     ORDER BY created_at DESC
     LIMIT $3 OFFSET $4`,
    [conversationId, viewerId, limit, offset]
  );
  return result.rows;
};

const findById = async (messageId) => {
  const result = await pool.query(
    `${baseSelect} WHERE m.id = $1`,
    [messageId]
  );
  return result.rows[0];
};

const softDelete = async (messageId) => {
  await pool.query(
    'UPDATE messages SET is_deleted = TRUE WHERE id = $1',
    [messageId]
  );
  return findById(messageId);
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

const hideMessageForUser = async (messageId, userId) => {
  await pool.query(
    `INSERT INTO hidden_messages (user_id, message_id)
     VALUES ($1, $2)
     ON CONFLICT (user_id, message_id) DO NOTHING`,
    [userId, messageId]
  );
};

const unhideMessageForUser = async (messageId, userId) => {
  await pool.query(
    `DELETE FROM hidden_messages
     WHERE user_id = $1 AND message_id = $2`,
    [userId, messageId]
  );
};

module.exports = {
  createMessage,
  findByConversation,
  findById,
  softDelete,
  markRead,
  hideMessageForUser,
  unhideMessageForUser,
};
