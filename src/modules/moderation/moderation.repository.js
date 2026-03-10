const pool = require('../../config/database');

const execute = (queryable, query, values) => queryable.query(query, values);

const createReport = async (report, queryable = pool) => {
  const query = `
    INSERT INTO reports (id, conversation_id, message_id, reported_by, reason)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING *;
  `;
  const values = [report.id, report.conversation_id, report.message_id, report.reported_by, report.reason];
  const result = await execute(queryable, query, values);
  return result.rows[0];
};

const findByConversation = async (conversationId) => {
  const result = await pool.query(
    'SELECT * FROM reports WHERE conversation_id = $1 ORDER BY created_at DESC',
    [conversationId]
  );
  return result.rows;
};

const findById = async (reportId, queryable = pool) => {
  const result = await execute(
    queryable,
    `SELECT r.*,
            reporter.pseudo AS reporter_pseudo,
            m.sender_id AS reported_message_sender_id,
            m.content AS reported_message_content,
            m.created_at AS reported_message_created_at,
            c.owner_id,
            c.anonymous_id,
            owner_user.pseudo AS owner_pseudo,
            anonymous_user.pseudo AS anonymous_pseudo
       FROM reports r
       LEFT JOIN users reporter ON reporter.id = r.reported_by
       LEFT JOIN messages m ON m.id = r.message_id
       INNER JOIN conversations c ON c.id = r.conversation_id
       LEFT JOIN users owner_user ON owner_user.id = c.owner_id
       LEFT JOIN users anonymous_user ON anonymous_user.id = c.anonymous_id
      WHERE r.id = $1`,
    [reportId],
  );
  return result.rows[0];
};

const listReports = async ({ status = 'pending', limit = 50 } = {}, queryable = pool) => {
  const params = [];
  const conditions = [];

  if (status) {
    params.push(status);
    conditions.push(`r.status = $${params.length}`);
  }

  params.push(Math.max(1, Math.min(Number(limit) || 50, 100)));

  const result = await execute(
    queryable,
    `SELECT r.*,
            reporter.pseudo AS reporter_pseudo,
            m.sender_id AS reported_message_sender_id,
            m.content AS reported_message_content,
            m.created_at AS reported_message_created_at,
            c.owner_id,
            c.anonymous_id,
            owner_user.pseudo AS owner_pseudo,
            anonymous_user.pseudo AS anonymous_pseudo
       FROM reports r
       LEFT JOIN users reporter ON reporter.id = r.reported_by
       LEFT JOIN messages m ON m.id = r.message_id
       INNER JOIN conversations c ON c.id = r.conversation_id
       LEFT JOIN users owner_user ON owner_user.id = c.owner_id
       LEFT JOIN users anonymous_user ON anonymous_user.id = c.anonymous_id
       ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
      ORDER BY r.created_at DESC
      LIMIT $${params.length}`,
    params,
  );
  return result.rows;
};

const updateReviewOutcome = async (
  reportId,
  { status, reviewedBy, decisionNote },
  queryable = pool,
) => {
  const result = await execute(
    queryable,
    `UPDATE reports
        SET status = $1,
            reviewed_at = NOW(),
            reviewed_by = $2,
            decision_note = $3
      WHERE id = $4
      RETURNING *`,
    [status, reviewedBy, decisionNote || null, reportId],
  );
  return result.rows[0];
};

module.exports = {
  createReport,
  findByConversation,
  findById,
  listReports,
  updateReviewOutcome,
};
