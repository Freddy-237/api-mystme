const moderationService = require('./moderation.service');
const conversationRepository = require('../conversation/conversation.repository');

const reportMessage = async (req, res, next) => {
  try {
    const { conversationId, messageId, reason } = req.body;
    if (!conversationId) return res.status(400).json({ message: 'conversationId requis' });
    if (reason && (typeof reason !== 'string' || reason.trim().length > 500)) {
      return res.status(400).json({ message: 'Raison invalide (max 500 caractères)' });
    }

    // Verify caller is a participant in the conversation
    const conv = await conversationRepository.findById(conversationId);
    if (!conv) return res.status(404).json({ message: 'Conversation introuvable' });
    if (conv.owner_id !== req.user.id && conv.anonymous_id !== req.user.id) {
      return res.status(403).json({ message: 'Non autorisé' });
    }

    const report = await moderationService.reportMessage(
      conversationId,
      messageId,
      req.user.id,
      reason
    );
    res.status(201).json(report);
  } catch (error) {
    next(error);
  }
};

module.exports = {
  reportMessage,
};
