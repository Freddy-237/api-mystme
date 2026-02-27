const { randomUUID: uuidv4 } = require('crypto');
const moderationRepository = require('./moderation.repository');

const reportMessage = async (conversationId, messageId, reportedBy, reason) => {
  return moderationRepository.createReport({
    id: uuidv4(),
    conversation_id: conversationId,
    message_id: messageId || null,
    reported_by: reportedBy,
    reason: reason || 'Contenu inapproprié',
  });
};

const getReports = async (conversationId) => {
  return moderationRepository.findByConversation(conversationId);
};

module.exports = {
  reportMessage,
  getReports,
};
