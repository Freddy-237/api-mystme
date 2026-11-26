const { randomUUID: uuidv4 } = require('crypto');
const moderationRepository = require('./moderation.repository');
const messageRepository = require('../message/message.repository');
const conversationRepository = require('../conversation/conversation.repository');
const identityRepository = require('../identity/identity.repository');
const AppError = require('../../utils/AppError');
const withTransaction = require('../../utils/withTransaction');

const EVIDENCE_CONTEXT = 3;

/**
 * Snapshot of what is reported, taken when the report is filed: the reported
 * message with a few messages around it (or the latest messages for a
 * conversation report). Kept on the report so moderators can still judge it
 * after the author deletes the message, the conversation or their account.
 * Participants are recorded by role only, never by id or pseudo.
 */
const buildEvidence = async (conversation, messageId) => {
  const pool = require('../../config/database');
  const cols = 'm.id, m.sender_id, m.content, m.media_type, m.media_url, m.is_deleted, m.created_at';
  let rows;
  if (messageId) {
    ({ rows } = await pool.query(
      `WITH target AS (SELECT created_at FROM messages WHERE id = $3)
       (SELECT ${cols} FROM messages m, target
         WHERE m.conversation_id = $1 AND m.created_at < target.created_at
         ORDER BY m.created_at DESC LIMIT $2)
       UNION ALL
       (SELECT ${cols} FROM messages m WHERE m.id = $3)
       UNION ALL
       (SELECT ${cols} FROM messages m, target
         WHERE m.conversation_id = $1 AND m.created_at > target.created_at
         ORDER BY m.created_at ASC LIMIT $2)`,
      [conversation.id, EVIDENCE_CONTEXT, messageId],
    ));
  } else {
    ({ rows } = await pool.query(
      `SELECT ${cols} FROM messages m WHERE m.conversation_id = $1
        ORDER BY m.created_at DESC LIMIT $2`,
      [conversation.id, EVIDENCE_CONTEXT * 2],
    ));
  }
  const roleOf = (userId) => {
    if (userId === conversation.owner_id) return 'owner';
    if (userId === conversation.anonymous_id) return 'anonymous';
    return null;
  };
  return rows
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
    .map((m) => ({
      id: m.id,
      role: roleOf(m.sender_id),
      content: m.content,
      mediaType: m.media_type || null,
      mediaUrl: m.media_url || null,
      isDeleted: !!m.is_deleted,
      isReported: m.id === messageId,
      createdAt: m.created_at,
    }));
};

const reportMessage = async (conversationId, messageId, reportedBy, reason) => {
  const conversation = await conversationRepository.findById(conversationId);
  if (!conversation) throw new AppError('Conversation introuvable', 404);
  let reportedUserId = null;
  if (messageId) {
    const message = await messageRepository.findById(messageId);
    if (!message) {
      throw new AppError('Message introuvable', 404);
    }
    if (message.conversation_id !== conversationId) {
      throw new AppError('Message de signalement invalide', 400);
    }
    reportedUserId = message.sender_id;
  } else if (conversation.owner_id === reportedBy) {
    reportedUserId = conversation.anonymous_id;
  } else if (conversation.anonymous_id === reportedBy) {
    reportedUserId = conversation.owner_id;
  }

  const existing = await moderationRepository.findExistingReport({
    conversationId,
    messageId: messageId || null,
    reportedBy,
  });
  if (existing) {
    return {
      ...existing,
      already_reported: true,
    };
  }

  const created = await moderationRepository.createReport({
    id: uuidv4(),
    conversation_id: conversationId,
    message_id: messageId || null,
    reported_by: reportedBy,
    reason: reason?.trim() || 'Contenu inapproprié',
    reported_user_id: reportedUserId,
    owner_id: conversation.owner_id,
    anonymous_id: conversation.anonymous_id,
    anonymous_alias: conversation.anonymous_alias || null,
    evidence: await buildEvidence(conversation, messageId || null),
  });

  const report = created
    ? await moderationRepository.findById(created.id)
    : await moderationRepository.findExistingReport({
        conversationId,
        messageId: messageId || null,
        reportedBy,
      });

  return {
    ...report,
    already_reported: !created,
  };
};

const getReports = async (conversationId) => {
  return moderationRepository.findByConversation(conversationId);
};

const listReports = async ({ status, limit }) => {
  if (status && !['pending', 'reviewed', 'dismissed'].includes(status)) {
    throw new AppError('Statut de report invalide', 400);
  }

  return moderationRepository.listReports({ status, limit });
};

const resolveReportedUserId = (report) => {
  if (report.reported_user_id) return report.reported_user_id;
  if (report.reported_message_sender_id) {
    return report.reported_message_sender_id;
  }

  if (report.owner_id === report.reported_by) {
    return report.anonymous_id;
  }

  if (report.anonymous_id === report.reported_by) {
    return report.owner_id;
  }

  return null;
};

const reviewReport = async (
  reportId,
  { actor, decision, note, blockConversation, hideMessage, banUser, banReason },
) => {
  if (!['reviewed', 'dismissed'].includes(decision)) {
    throw new AppError('Décision de modération invalide', 400);
  }

  return withTransaction(async (client) => {
    const report = await moderationRepository.findById(reportId, client);
    if (!report) {
      throw new AppError('Signalement introuvable', 404);
    }
    if (report.status !== 'pending') {
      throw new AppError('Signalement déjà traité', 409);
    }

    const targetUserId = resolveReportedUserId(report);

    if (decision === 'reviewed') {
      // The message / conversation may already be gone (deleted by its
      // author or with their account): nothing left to hide or block then.
      if (hideMessage) {
        if (report.kind !== 'message') {
          throw new AppError('Aucun message à masquer pour ce signalement', 400);
        }
        if (report.message_id) await messageRepository.softDelete(report.message_id, client);
      }

      if (blockConversation && report.conversation_id) {
        await conversationRepository.blockConversation(report.conversation_id, client);
      }

      if (banUser) {
        if (!targetUserId) {
          throw new AppError('Impossible d’identifier l’utilisateur signalé', 400);
        }
        const target = await client.query('SELECT 1 FROM users WHERE id = $1', [targetUserId]);
        if (target.rowCount === 0) {
          throw new AppError('Ce compte a déjà été supprimé par son propriétaire', 409, 'ADMIN_TARGET_DELETED');
        }
        await identityRepository.updateBanState(
          targetUserId,
          { isBanned: true, reason: banReason || note || 'Décision de modération' },
          client,
        );
      }
    }

    return moderationRepository.updateReviewOutcome(
      reportId,
      {
        status: decision,
        reviewedBy: actor,
        decisionNote: note,
      },
      client,
    );
  });
};

module.exports = {
  reportMessage,
  getReports,
  listReports,
  reviewReport,
};
