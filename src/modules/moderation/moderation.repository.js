const pool = require('../../config/database');
const env = require('../../config/env');

const execute = (queryable, query, values) => queryable.query(query, values);

const autoFlagThreshold = env.moderationAutoFlagThreshold;

// The reported account and the participants are stored on the report itself
// (migration 025), so a report stays readable after the conversation, the
// message or the accounts involved have been deleted.
const signalSummarySql = (targetSql) => `
  SELECT COUNT(*)::int AS total_report_count,
         COUNT(DISTINCT rr.reported_by)::int AS unique_reporter_count
    FROM reports rr
   WHERE rr.status <> 'dismissed'
     AND rr.reported_user_id = ${targetSql}
`;

const buildReportSelect = () => `
    SELECT r.*,
           reporter.pseudo AS reporter_pseudo,
           m.sender_id AS reported_message_sender_id,
           COALESCE(m.content, ev.content) AS reported_message_content,
           COALESCE(m.created_at, ev.created_at) AS reported_message_created_at,
           owner_user.pseudo AS owner_pseudo,
           anonymous_user.pseudo AS anonymous_pseudo,
           COALESCE(signal_summary.total_report_count, 0)::int AS total_report_count,
           COALESCE(signal_summary.unique_reporter_count, 0)::int AS unique_reporter_count,
           ${autoFlagThreshold}::int AS auto_flag_threshold,
           (COALESCE(signal_summary.unique_reporter_count, 0) >= ${autoFlagThreshold}) AS auto_flagged
      FROM reports r
      LEFT JOIN users reporter ON reporter.id = r.reported_by
      LEFT JOIN messages m ON m.id = r.message_id
      LEFT JOIN users owner_user ON owner_user.id = r.owner_id
      LEFT JOIN users anonymous_user ON anonymous_user.id = r.anonymous_id
      LEFT JOIN LATERAL (
        SELECT e->>'content' AS content, (e->>'createdAt')::timestamp AS created_at
          FROM jsonb_array_elements(COALESCE(r.evidence, '[]'::jsonb)) e
         WHERE (e->>'isReported')::boolean
         LIMIT 1
      ) ev ON TRUE
      LEFT JOIN LATERAL (${signalSummarySql('r.reported_user_id')}) signal_summary ON TRUE
  `;

const mapReportInsertValues = (report) => [
  report.id,
  report.conversation_id,
  report.message_id,
  report.reported_by,
  report.reason,
  report.message_id ? 'message' : 'conversation',
  report.reported_user_id || null,
  report.owner_id || null,
  report.anonymous_id || null,
  report.anonymous_alias || null,
  report.evidence ? JSON.stringify(report.evidence) : null,
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
        return `r.conversation_id = $${params.length} AND r.kind = 'conversation'`;
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
    INSERT INTO reports (id, conversation_id, message_id, reported_by, reason,
                         kind, reported_user_id, owner_id, anonymous_id, anonymous_alias, evidence)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
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
         LEFT JOIN LATERAL (${signalSummarySql('target.user_id')}) signal_summary ON TRUE`,
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
