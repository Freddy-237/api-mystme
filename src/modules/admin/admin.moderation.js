/**
 * Moderation as seen from the back-office.
 *
 * Moderators judge CONTENT, not people. They never receive a pseudo, a real
 * user id or the other conversations of an account:
 *  - participants are named by their role in the conversation
 *    ("anonymous" / "owner") and the per-conversation alias;
 *  - an account is designated by an opaque reference (HMAC of its id), enough
 *    to see "the same account was reported 3 times" and to lift a ban;
 *  - the context is limited to a few messages around the reported one.
 */
const pool = require('../../config/database');
const AppError = require('../../utils/AppError');
const moderationRepository = require('../moderation/moderation.repository');
const moderationService = require('../moderation/moderation.service');
const identityRepository = require('../identity/identity.repository');
const withTransaction = require('../../utils/withTransaction');
const { userRef } = require('./admin.crypto');

const CONTEXT_SIZE = 3;
const STATUSES = ['pending', 'reviewed', 'dismissed'];

const roleOf = (report, userId) => {
  if (!userId) return null;
  if (userId === report.owner_id) return 'owner';
  if (userId === report.anonymous_id) return 'anonymous';
  return null;
};

const loadExtras = async (reportIds) => {
  if (!reportIds.length) return new Map();
  const r = await pool.query(
    `SELECT r.id AS report_id,
            c.anonymous_alias, c.status AS conversation_status,
            m.media_type, m.media_url, m.is_deleted AS message_deleted,
            u.is_banned AS target_banned,
            a.display_name AS reviewer_name
       FROM reports r
       JOIN conversations c ON c.id = r.conversation_id
       LEFT JOIN messages m ON m.id = r.message_id
       LEFT JOIN users u ON u.id = COALESCE(
              m.sender_id,
              CASE WHEN c.owner_id = r.reported_by THEN c.anonymous_id
                   WHEN c.anonymous_id = r.reported_by THEN c.owner_id END)
       LEFT JOIN admin_users a
              ON r.reviewed_by LIKE 'admin:%'
             AND a.id::text = SUBSTRING(r.reviewed_by FROM 7)
      WHERE r.id = ANY($1::uuid[])`,
    [reportIds],
  );
  return new Map(r.rows.map((row) => [row.report_id, row]));
};

const sanitize = (report, extra = {}) => {
  const reportedRole = roleOf(report, report.reported_user_id);
  return {
    id: report.id,
    status: report.status,
    reason: report.reason,
    createdAt: report.created_at,
    reviewedAt: report.reviewed_at || null,
    reviewedBy: report.reviewed_by
      ? (extra.reviewer_name || (report.reviewed_by.startsWith('admin:') ? 'Admin supprimé' : 'Console de modération'))
      : null,
    decisionNote: report.decision_note || null,
    reportedRole,
    reporterRole: roleOf(report, report.reported_by),
    conversation: {
      id: report.conversation_id,
      alias: extra.anonymous_alias || 'Anonyme',
      status: extra.conversation_status || null,
    },
    message: report.message_id
      ? {
          id: report.message_id,
          content: report.reported_message_content ?? null,
          mediaType: extra.media_type || null,
          mediaUrl: extra.media_url || null,
          createdAt: report.reported_message_created_at || null,
          isDeleted: !!extra.message_deleted,
        }
      : null,
    target: {
      ref: userRef(report.reported_user_id),
      isBanned: !!extra.target_banned,
      reportCount: report.total_report_count,
      uniqueReporters: report.unique_reporter_count,
      autoFlagged: !!report.auto_flagged,
    },
  };
};

const listReports = async ({ status = 'pending', limit = 50 } = {}) => {
  if (!STATUSES.includes(status)) throw new AppError('Statut invalide', 400);
  const rows = await moderationRepository.listReports({ status, limit });
  const extras = await loadExtras(rows.map((r) => r.id));
  const items = rows.map((r) => sanitize(r, extras.get(r.id)));
  // Most urgent first: auto-flagged, then most distinct reporters, then oldest.
  if (status === 'pending') {
    items.sort((a, b) =>
      (Number(b.target.autoFlagged) - Number(a.target.autoFlagged))
      || (b.target.uniqueReporters - a.target.uniqueReporters)
      || (new Date(a.createdAt) - new Date(b.createdAt)));
  }
  return items;
};

const loadContext = async (report) => {
  const params = [report.conversation_id, CONTEXT_SIZE];
  let rows;
  if (report.message_id) {
    params.push(report.message_id);
    const r = await pool.query(
      `WITH target AS (SELECT created_at FROM messages WHERE id = $3)
       (SELECT m.id, m.sender_id, m.content, m.media_type, m.media_url, m.is_deleted, m.created_at
          FROM messages m, target
         WHERE m.conversation_id = $1 AND m.created_at < target.created_at
         ORDER BY m.created_at DESC LIMIT $2)
       UNION ALL
       (SELECT m.id, m.sender_id, m.content, m.media_type, m.media_url, m.is_deleted, m.created_at
          FROM messages m WHERE m.id = $3)
       UNION ALL
       (SELECT m.id, m.sender_id, m.content, m.media_type, m.media_url, m.is_deleted, m.created_at
          FROM messages m, target
         WHERE m.conversation_id = $1 AND m.created_at > target.created_at
         ORDER BY m.created_at ASC LIMIT $2)`,
      params,
    );
    rows = r.rows;
  } else {
    const r = await pool.query(
      `SELECT id, sender_id, content, media_type, media_url, is_deleted, created_at
         FROM messages WHERE conversation_id = $1
        ORDER BY created_at DESC LIMIT $2 * 2`,
      params,
    );
    rows = r.rows;
  }
  return rows
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
    .map((m) => ({
      id: m.id,
      role: roleOf(report, m.sender_id),
      content: m.content,
      mediaType: m.media_type || null,
      mediaUrl: m.media_url || null,
      isDeleted: !!m.is_deleted,
      isReported: m.id === report.message_id,
      createdAt: m.created_at,
    }));
};

const getReport = async (reportId) => {
  const report = await moderationRepository.findById(reportId);
  if (!report) throw new AppError('Signalement introuvable', 404);
  const extras = await loadExtras([report.id]);
  return { ...sanitize(report, extras.get(report.id)), context: await loadContext(report) };
};

const reviewReport = async (admin, reportId, body = {}) => {
  const decision = body.decision;
  const banUser = !!body.banUser;
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 1000) : '';
  if (banUser && !note && !(body.banReason || '').trim()) {
    throw new AppError('Indique le motif du bannissement', 400, 'ADMIN_BAN_REASON_REQUIRED');
  }

  const before = await moderationRepository.findById(reportId);
  if (!before) throw new AppError('Signalement introuvable', 404);

  await moderationService.reviewReport(reportId, {
    actor: `admin:${admin.id}`,
    decision,
    note,
    hideMessage: !!body.hideMessage,
    blockConversation: !!body.blockConversation,
    banUser,
    banReason: (body.banReason || '').trim().slice(0, 500) || undefined,
  });

  if (decision === 'reviewed' && banUser && before.reported_user_id) {
    await pool.query('UPDATE users SET banned_by = $2 WHERE id = $1', [before.reported_user_id, `admin:${admin.id}`]);
    // Log the banned account out everywhere right away.
    await identityRepository.bumpSessionVersion(before.reported_user_id);
  }

  return {
    report: await getReport(reportId),
    targetRef: userRef(before.reported_user_id),
  };
};

// ── Bans ────────────────────────────────────────────────────────────────────
const listBans = async ({ limit = 100 } = {}) => {
  const r = await pool.query(
    `SELECT u.id, u.origin, u.ban_reason, u.banned_at, u.created_at,
            a.display_name AS banned_by_name, u.banned_by
       FROM users u
       LEFT JOIN admin_users a
              ON u.banned_by LIKE 'admin:%' AND a.id::text = SUBSTRING(u.banned_by FROM 7)
      WHERE u.is_banned
      ORDER BY u.banned_at DESC NULLS LAST
      LIMIT $1`,
    [Math.max(1, Math.min(Number(limit) || 100, 500))],
  );
  return r.rows.map((u) => ({
    ref: userRef(u.id),
    origin: u.origin,
    reason: u.ban_reason,
    bannedAt: u.banned_at,
    bannedBy: u.banned_by_name || (u.banned_by ? 'Admin supprimé' : 'Console de modération'),
    accountCreatedAt: u.created_at,
  }));
};

const unban = async (ref, reason) => {
  const why = String(reason || '').trim();
  if (!why) throw new AppError('Indique pourquoi tu lèves le bannissement', 400, 'ADMIN_UNBAN_REASON_REQUIRED');
  if (!/^[0-9a-f]{10}$/.test(String(ref || ''))) throw new AppError('Référence invalide', 400);

  return withTransaction(async (client) => {
    const banned = await client.query('SELECT id FROM users WHERE is_banned FOR UPDATE');
    const match = banned.rows.find((u) => userRef(u.id) === ref);
    if (!match) throw new AppError('Aucun compte banni avec cette référence', 404);
    await identityRepository.updateBanState(match.id, { isBanned: false }, client);
    await client.query('UPDATE users SET banned_by = NULL WHERE id = $1', [match.id]);
    return { ref, reason: why.slice(0, 500) };
  });
};

module.exports = {
  listReports,
  getReport,
  reviewReport,
  listBans,
  unban,
};
