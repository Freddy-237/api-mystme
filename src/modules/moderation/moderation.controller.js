const moderationService = require('./moderation.service');

const reportMessage = async (req, res, next) => {
  try {
    const { conversationId, messageId, reason } = req.body;
    if (!conversationId) return res.status(400).json({ message: 'conversationId requis' });

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
