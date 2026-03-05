const trustService = require('./trust.service');
const conversationRepository = require('../conversation/conversation.repository');

/**
 * Verify the caller is a participant in the conversation.
 */
const assertParticipant = async (conversationId, userId) => {
  const conv = await conversationRepository.findById(conversationId);
  if (!conv) throw Object.assign(new Error('Conversation introuvable'), { statusCode: 404 });
  if (conv.owner_id !== userId && conv.anonymous_id !== userId) {
    throw Object.assign(new Error('Non autorisé'), { statusCode: 403 });
  }
};

const getTrust = async (req, res, next) => {
  try {
    await assertParticipant(req.params.conversationId, req.user.id);
    const trust = await trustService.getTrust(req.params.conversationId);
    res.json(trust || { status: 'new' });
  } catch (error) {
    next(error);
  }
};

const upgradeTrust = async (req, res, next) => {
  try {
    await assertParticipant(req.params.conversationId, req.user.id);
    const { targetStatus } = req.body || {};
    const trust = await trustService.upgradeTrust(req.params.conversationId, targetStatus);
    res.json(trust);
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getTrust,
  upgradeTrust,
};
