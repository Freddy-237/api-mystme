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
  return conv;
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
    const conv = await assertParticipant(req.params.conversationId, req.user.id);
    // Raising the trust level moves towards revealing the anonymous side:
    // that is their decision alone, never the link owner's.
    if (conv.anonymous_id !== req.user.id) {
      throw Object.assign(new Error('Seul le correspondant anonyme peut lever son anonymat'), { statusCode: 403 });
    }
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
