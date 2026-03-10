const { randomUUID: uuidv4 } = require('crypto');
const conversationRepository = require('./conversation.repository');
const linkRepository = require('../link/link.repository');
const identityRepository = require('../identity/identity.repository');
const trustService = require('../trust/trust.service');
const AppError = require('../../utils/AppError');

/**
 * Start a conversation via an invite code.
 * The anonymous user joins the link owner's conversation.
 */
const startConversation = async (inviteCode, anonymousUserId) => {
  // Find the link
  const link = await linkRepository.findByCode(inviteCode);
  if (!link) throw new AppError('Lien introuvable', 404);

  // Prevent self-conversations
  if (link.owner_id === anonymousUserId) {
    throw new AppError('Vous ne pouvez pas démarrer une conversation avec vous-même', 400);
  }

  const { conversation, created } = await conversationRepository.findOrCreateByLinkAndAnonymous({
    id: uuidv4(),
    owner_id: link.owner_id,
    anonymous_id: anonymousUserId,
    link_id: link.id,
  });

  if (created) {
    try {
      await trustService.initTrust(conversation.id);
    } catch (_) {
      // Non-blocking — trust can be initialized later
    }
  }

  return conversation;
};

/**
 * Resolve an invite code to a conversation and return context needed by mobile deep-link UX.
 * Creates conversation when necessary (same behavior as startConversation).
 */
const resolveLink = async (inviteCode, anonymousUserId) => {
  const conversation = await startConversation(inviteCode, anonymousUserId);

  return {
    conversation,
    conversationId: conversation.id,
    ownerId: conversation.owner_id,
    targetPseudo: conversation.owner_pseudo || 'Anonyme',
    anonymousPseudo: conversation.anonymous_pseudo || 'Ghost_92',
  };
};

/** Assert user is a participant of the conversation, return the conversation. */
const assertParticipant = async (conversationId, userId) => {
  const conv = await conversationRepository.findById(conversationId);
  if (!conv) throw new AppError('Conversation introuvable', 404);
  if (conv.owner_id !== userId && conv.anonymous_id !== userId) {
    throw new AppError('Non autorisé', 403);
  }
  return conv;
};

const getConversation = async (conversationId, userId) => {
  return assertParticipant(conversationId, userId);
};

const getMyConversations = async (userId) => {
  return conversationRepository.findByParticipantWithUnread(userId);
};

const blockConversation = async (conversationId, userId) => {
  await assertParticipant(conversationId, userId);
  return conversationRepository.blockConversation(conversationId);
};

const archiveConversation = async (conversationId, userId) => {
  await assertParticipant(conversationId, userId);
  return conversationRepository.archiveConversation(conversationId, userId);
};

const deleteConversation = async (conversationId, userId) => {
  await assertParticipant(conversationId, userId);
  return conversationRepository.softDeleteConversation(conversationId, userId);
};

const markAsRead = async (conversationId, userId) => {
  await assertParticipant(conversationId, userId);
  await conversationRepository.markConversationRead(conversationId, userId);
  return { success: true };
};

module.exports = {
  startConversation,
  resolveLink,
  getConversation,
  getMyConversations,
  blockConversation,
  archiveConversation,
  deleteConversation,
  markAsRead,
};
