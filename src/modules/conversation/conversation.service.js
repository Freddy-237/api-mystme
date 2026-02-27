const { randomUUID: uuidv4 } = require('crypto');
const conversationRepository = require('./conversation.repository');
const linkRepository = require('../link/link.repository');
const identityRepository = require('../identity/identity.repository');

/**
 * Start a conversation via an invite code.
 * The anonymous user joins the link owner's conversation.
 */
const startConversation = async (inviteCode, anonymousUserId) => {
  // Find the link
  const link = await linkRepository.findByCode(inviteCode);
  if (!link) throw Object.assign(new Error('Lien introuvable'), { statusCode: 404 });

  // Prevent self-conversations
  if (link.owner_id === anonymousUserId) {
    throw Object.assign(new Error('Vous ne pouvez pas démarrer une conversation avec vous-même'), { statusCode: 400 });
  }

  // Check if conversation already exists for this link + anonymous user
  const existing = await conversationRepository.findByLinkAndAnonymous(link.id, anonymousUserId);
  if (existing) return existing;

  // Create new conversation
  const conversation = await conversationRepository.createConversation({
    id: uuidv4(),
    owner_id: link.owner_id,
    anonymous_id: anonymousUserId,
    link_id: link.id,
  });

  return conversation;
};

/**
 * Resolve an invite code to a conversation and return context needed by mobile deep-link UX.
 * Creates conversation when necessary (same behavior as startConversation).
 */
const resolveLink = async (inviteCode, anonymousUserId) => {
  const conversation = await startConversation(inviteCode, anonymousUserId);

  const owner = await identityRepository.findById(conversation.owner_id);
  const anonymous = await identityRepository.findById(anonymousUserId);

  return {
    conversationId: conversation.id,
    ownerId: conversation.owner_id,
    targetPseudo: owner?.pseudo || 'Anonyme',
    anonymousPseudo: anonymous?.pseudo || 'Ghost_92',
  };
};

const getConversation = async (conversationId, userId) => {
  const conv = await conversationRepository.findById(conversationId);
  if (!conv) throw Object.assign(new Error('Conversation introuvable'), { statusCode: 404 });
  if (conv.owner_id !== userId && conv.anonymous_id !== userId) {
    throw Object.assign(new Error('Non autorisé'), { statusCode: 403 });
  }
  return conv;
};

const getMyConversations = async (userId) => {
  return conversationRepository.findByParticipantWithUnread(userId);
};

const blockConversation = async (conversationId, userId) => {
  const conv = await conversationRepository.findById(conversationId);
  if (!conv) throw Object.assign(new Error('Conversation introuvable'), { statusCode: 404 });
  if (conv.owner_id !== userId && conv.anonymous_id !== userId) {
    throw Object.assign(new Error('Non autorisé'), { statusCode: 403 });
  }
  return conversationRepository.blockConversation(conversationId);
};

const archiveConversation = async (conversationId, userId) => {
  const conv = await conversationRepository.findById(conversationId);
  if (!conv) throw Object.assign(new Error('Conversation introuvable'), { statusCode: 404 });
  if (conv.owner_id !== userId && conv.anonymous_id !== userId) {
    throw Object.assign(new Error('Non autorisé'), { statusCode: 403 });
  }
  return conversationRepository.archiveConversation(conversationId);
};

const deleteConversation = async (conversationId, userId) => {
  const conv = await conversationRepository.findById(conversationId);
  if (!conv) throw Object.assign(new Error('Conversation introuvable'), { statusCode: 404 });
  if (conv.owner_id !== userId && conv.anonymous_id !== userId) {
    throw Object.assign(new Error('Non autorisé'), { statusCode: 403 });
  }
  return conversationRepository.softDeleteConversation(conversationId);
};

const markAsRead = async (conversationId, userId) => {
  const conv = await conversationRepository.findById(conversationId);
  if (!conv) throw Object.assign(new Error('Conversation introuvable'), { statusCode: 404 });
  if (conv.owner_id !== userId && conv.anonymous_id !== userId) {
    throw Object.assign(new Error('Non autorisé'), { statusCode: 403 });
  }
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
