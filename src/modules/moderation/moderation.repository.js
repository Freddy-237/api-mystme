const pool = require('../../config/database');

const createReport = async (report) => {
  const query = `
    INSERT INTO reports (id, conversation_id, message_id, reported_by, reason)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING *;
  `;
  const values = [report.id, report.conversation_id, report.message_id, report.reported_by, report.reason];
  const result = await pool.query(query, values);
  return result.rows[0];
};

const findByConversation = async (conversationId) => {
  const result = await pool.query(
    'SELECT * FROM reports WHERE conversation_id = $1 ORDER BY created_at DESC',
    [conversationId]
  );
  return result.rows;
};

module.exports = {
  createReport,
  findByConversation,
};
