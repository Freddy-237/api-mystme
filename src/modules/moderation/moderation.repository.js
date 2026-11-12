const pool = require('../../config/database');
const env = require('../../config/env');

const execute = (queryable, query, values) => queryable.query(query, values);

const autoFlagThreshold = env.moderationAutoFlagThreshold;

const resolveReportedUserSql = ({ reportAlias, conversationAlias, messageAlias }) => `
  COALESCE(
    ${messageAlias}.sender_id,
    CASE
      WHEN ${conversationAlias}.owner_id = ${reportAlias}.reported_by THEN ${conversationAlias}.anonymous_id
      WHEN ${conversationAlias}.anonymous_id = ${reportAlias}.reported_by THEN ${conversationAlias}.owner_id
      ELSE NULL
    END
  )
`;

const buildReportSelect = ({ reportAlias = 'r', conversationAlias = 'c', messageAlias = 'm', reporterAlias = 'reporter', ownerAlias = 'owner_user', anonymousAlias = 'anonymous_user' } = {}) => {
  const reportedUserSql = resolveReportedUserSql({
    reportAlias,
    conversationAlias,
    messageAlias,
  });

  return `
    SELECT ${reportAlias}.*,
           ${reporterAlias}.pseudo AS reporter_pseudo,
           ${messageAlias}.sender_id AS reported_message_sender_id,
           ${messageAlias}.content AS reported_message_content,
           ${messageAlias}.created_at AS reported_message_created_at,
           ${conversationAlias}.owner_id,
           ${conversationAlias}.anonymous_id,
           ${ownerAlias}.pseudo AS owner_pseudo,
           ${anonymousAlias}.pseudo AS anonymous_pseudo,
           ${reportedUserSql} AS reported_user_id,
           COALESCE(signal_summary.total_report_count, 0)::int AS total_report_count,
           COALESCE(signal_summary.unique_reporter_count, 0)::int AS unique_reporter_count,
           ${autoFlagThreshold}::int AS auto_flag_threshold,
           (COALESCE(signal_summary.unique_reporter_count, 0) >= ${autoFlagThreshold}) AS auto_flagged
      FROM reports ${reportAlias}
      LEFT JOIN users ${reporterAlias} ON ${reporterAlias}.id = ${reportAlias}.reported_by
      LEFT JOIN messages ${messageAlias} ON ${messageAlias}.id = ${reportAlias}.message_id
      INNER JOIN conversations ${conversationAlias} ON ${conversationAlias}.id = ${reportAlias}.conversation_id
      LEFT JOIN users ${ownerAlias} ON ${ownerAlias}.id = ${conversationAlias}.owner_id
      LEFT JOIN users ${anonymousAlias} ON ${anonymousAlias}.id = ${conversationAlias}.anonymous_id
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS total_report_count,
               COUNT(DISTINCT rr.reported_by)::int AS unique_reporter_count
          FROM reports rr
          INNER JOIN conversations rc ON rc.id = rr.conversation_id
          LEFT JOIN messages rm ON rm.id = rr.message_id
         WHERE rr.status <> 'dismissed'
           AND ${resolveReportedUserSql({
             reportAlias: 'rr',
             conversationAlias: 'rc',
             messageAlias: 'rm',
           })} = ${reportedUserSql}
      ) signal_summary ON TRUE
  `;
};

const mapReportInsertValues = (report) => [
  report.id,
  report.conversation_id,
  report.message_id,
  report.reported_by,
  report.reason,
];

const findExistingReport = async ({ conversationId, messageId, reportedBy }, queryable = pool) => {
  const params = [reportedBy];
  const targetCondition = messageId
    ? (() => {
        params.push(messageId);
        return `r.message_id = $${params.length}`;
      })()
    : (() => {
        params.push(conversationId);
        return `r.conversation_id = $${params.length} AND r.message_id IS NULL`;
      })();

  const result = await execute(
    queryable,
    `${buildReportSelect()}
      WHERE ${targetCondition}
        AND r.reported_by = $1`,
    params,
  );
  return result.rows[0] || null;
};

const createReport = async (report, queryable = pool) => {
  const query = `
    INSERT INTO reports (id, conversation_id, message_id, reported_by, reason)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING *;
  `;
  try {
    const result = await execute(queryable, query, mapReportInsertValues(report));
    return result.rows[0];
  } catch (error) {
    if (error && error.code === '23505') {
      return null;
    }
    throw error;
  }
};

const findByConversation = async (conversationId) => {
  const result = await pool.query(
    `${buildReportSelect()}
      WHERE r.conversation_id = $1
      ORDER BY r.created_at DESC`,
    [conversationId]
  );
  return result.rows;
};

const findById = async (reportId, queryable = pool) => {
  const result = await execute(
    queryable,
    `${buildReportSelect()}
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
    `${buildReportSelect()}
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
  return result.rows[0] ? findById(reportId, queryable) : null;
};

module.exports = {
  createReport,
  findExistingReport,
  findByConversation,
  findById,
  getUserSignalSummary: async (userId, queryable = pool) => {
    const result = await execute(
      queryable,
      `SELECT COALESCE(signal_summary.total_report_count, 0)::int AS total_report_count,
              COALESCE(signal_summary.unique_reporter_count, 0)::int AS unique_reporter_count,
              ${autoFlagThreshold}::int AS auto_flag_threshold,
              (COALESCE(signal_summary.unique_reporter_count, 0) >= ${autoFlagThreshold}) AS auto_flagged
         FROM (SELECT $1::uuid AS user_id) target
         LEFT JOIN LATERAL (
           SELECT COUNT(*)::int AS total_report_count,
                  COUNT(DISTINCT rr.reported_by)::int AS unique_reporter_count
             FROM reports rr
             INNER JOIN conversations rc ON rc.id = rr.conversation_id
             LEFT JOIN messages rm ON rm.id = rr.message_id
            WHERE rr.status <> 'dismissed'
              AND ${resolveReportedUserSql({
                reportAlias: 'rr',
                conversationAlias: 'rc',
                messageAlias: 'rm',
              })} = target.user_id
         ) signal_summary ON TRUE`,
      [userId],
    );

    return result.rows[0] || {
      total_report_count: 0,
      unique_reporter_count: 0,
      auto_flag_threshold: autoFlagThreshold,
      auto_flagged: false,
    };
  },
  listReports,
  updateReviewOutcome,
};
