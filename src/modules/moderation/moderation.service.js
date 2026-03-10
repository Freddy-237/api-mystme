const { randomUUID: uuidv4 } = require('crypto');
const moderationRepository = require('./moderation.repository');
const messageRepository = require('../message/message.repository');
const conversationRepository = require('../conversation/conversation.repository');
const identityRepository = require('../identity/identity.repository');
const AppError = require('../../utils/AppError');
const withTransaction = require('../../utils/withTransaction');

const reportMessage = async (conversationId, messageId, reportedBy, reason) => {
  if (messageId) {
    const message = await messageRepository.findById(messageId);
    if (!message) {
      throw new AppError('Message introuvable', 404);
    }
    if (message.conversation_id !== conversationId) {
      throw new AppError('Message de signalement invalide', 400);
    }
  }

  return moderationRepository.createReport({
    id: uuidv4(),
    conversation_id: conversationId,
    message_id: messageId || null,
    reported_by: reportedBy,
    reason: reason?.trim() || 'Contenu inapproprié',
  });
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
      if (hideMessage) {
        if (!report.message_id) {
          throw new AppError('Aucun message à masquer pour ce signalement', 400);
        }
        await messageRepository.softDelete(report.message_id, client);
      }

      if (blockConversation) {
        await conversationRepository.blockConversation(report.conversation_id, client);
      }

      if (banUser) {
        if (!targetUserId) {
          throw new AppError('Impossible d’identifier l’utilisateur signalé', 400);
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
