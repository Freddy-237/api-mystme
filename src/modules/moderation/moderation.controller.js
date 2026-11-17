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
    // The full report (participant ids, pseudos, report counts) is for
    // moderators only. The reporter just gets an acknowledgement.
    res.status(report.already_reported ? 200 : 201).json({
      id: report.id,
      conversation_id: report.conversation_id,
      message_id: report.message_id,
      reason: report.reason,
      status: report.status,
      created_at: report.created_at,
      already_reported: !!report.already_reported,
    });
  } catch (error) {
    next(error);
  }
};

const listReports = async (req, res, next) => {
  try {
    const reports = await moderationService.listReports({
      status: req.query.status,
      limit: req.query.limit,
    });
    res.json(reports);
  } catch (error) {
    next(error);
  }
};

const reviewReport = async (req, res, next) => {
  try {
    const { decision, note, blockConversation = false, hideMessage = false, banUser = false, banReason } = req.body;
    const actor = req.moderatorActor || 'system';

    if (note && (typeof note !== 'string' || note.trim().length > 1000)) {
      return res.status(400).json({ message: 'Note de review invalide (max 1000 caractères)' });
    }

    const report = await moderationService.reviewReport(req.params.id, {
      actor,
      decision,
      note: note?.trim(),
      blockConversation: !!blockConversation,
      hideMessage: !!hideMessage,
      banUser: !!banUser,
      banReason: typeof banReason === 'string' ? banReason.trim() : undefined,
    });

    res.json(report);
  } catch (error) {
    next(error);
  }
};

module.exports = {
  reportMessage,
  listReports,
  reviewReport,
};
