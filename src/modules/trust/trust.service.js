const { randomUUID: uuidv4 } = require('crypto');
const trustRepository = require('./trust.repository');

/**
 * Trust levels: new → known → trusted → revealed
 */
const TRUST_LEVELS = ['new', 'known', 'trusted', 'revealed'];

const initTrust = async (conversationId) => {
  return trustRepository.createTrustStatus({
    id: uuidv4(),
    conversation_id: conversationId,
    status: 'new',
  });
};

const getTrust = async (conversationId) => {
  const trust = await trustRepository.findByConversation(conversationId);
  if (!trust) return null;
  return trust;
};

const upgradeTrust = async (conversationId) => {
  const current = await trustRepository.findByConversation(conversationId);
  if (!current) throw Object.assign(new Error('Trust non initialisé'), { statusCode: 404 });

  const currentIndex = TRUST_LEVELS.indexOf(current.status);
  if (currentIndex >= TRUST_LEVELS.length - 1) {
    return current; // Already at max level
  }

  const nextStatus = TRUST_LEVELS[currentIndex + 1];
  return trustRepository.updateStatus(conversationId, nextStatus);
};

module.exports = {
  initTrust,
  getTrust,
  upgradeTrust,
  TRUST_LEVELS,
};
