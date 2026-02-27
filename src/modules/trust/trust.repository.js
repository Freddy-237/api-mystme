const pool = require('../../config/database');

const createTrustStatus = async (trust) => {
  const query = `
    INSERT INTO trust_status (id, conversation_id, status)
    VALUES ($1, $2, $3)
    RETURNING *;
  `;
  const values = [trust.id, trust.conversation_id, trust.status || 'new'];
  const result = await pool.query(query, values);
  return result.rows[0];
};

const findByConversation = async (conversationId) => {
  const result = await pool.query(
    'SELECT * FROM trust_status WHERE conversation_id = $1 ORDER BY updated_at DESC LIMIT 1',
    [conversationId]
  );
  return result.rows[0];
};

const updateStatus = async (conversationId, status) => {
  const result = await pool.query(
    'UPDATE trust_status SET status = $1, updated_at = NOW() WHERE conversation_id = $2 RETURNING *',
    [status, conversationId]
  );
  return result.rows[0];
};

module.exports = {
  createTrustStatus,
  findByConversation,
  updateStatus,
};
