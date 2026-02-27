const { randomUUID: uuidv4 } = require('crypto');
const messageRepository = require('./message.repository');
const conversationRepository = require('../conversation/conversation.repository');

const sendMessage = async (conversationId, senderId, content) => {
  // Verify conversation exists and is active
  const conv = await conversationRepository.findById(conversationId);
  if (!conv) throw Object.assign(new Error('Conversation introuvable'), { statusCode: 404 });
  if (conv.status === 'blocked') throw Object.assign(new Error('Conversation bloquée'), { statusCode: 403 });

  // Server-side expiry enforcement (7 days from started_at)
  if (conv.started_at) {
    const expiresAt = new Date(conv.started_at);
    expiresAt.setDate(expiresAt.getDate() + 7);
    if (new Date() > expiresAt) {
      throw Object.assign(new Error('Conversation expirée'), { statusCode: 403 });
    }
  }

  // Verify sender is part of the conversation
  if (conv.owner_id !== senderId && conv.anonymous_id !== senderId) {
    throw Object.assign(new Error('Non autorisé'), { statusCode: 403 });
  }

  const message = await messageRepository.createMessage({
    id: uuidv4(),
    conversation_id: conversationId,
    sender_id: senderId,
    content,
  });

  return message;
};

const getMessages = async (conversationId, userId, limit, offset) => {
  // Verify user has access
  const conv = await conversationRepository.findById(conversationId);
  if (!conv) throw Object.assign(new Error('Conversation introuvable'), { statusCode: 404 });
  if (conv.owner_id !== userId && conv.anonymous_id !== userId) {
    throw Object.assign(new Error('Non autorisé'), { statusCode: 403 });
  }

  return messageRepository.findByConversation(conversationId, limit, offset);
};

const deleteMessage = async (messageId, userId) => {
  const msg = await messageRepository.findById(messageId);
  if (!msg) throw Object.assign(new Error('Message introuvable'), { statusCode: 404 });
  if (msg.sender_id !== userId) {
    throw Object.assign(new Error('Non autorisé — seul l\'auteur peut supprimer'), { statusCode: 403 });
  }
  const deleted = await messageRepository.softDelete(messageId);
  return deleted;
};

const sendVideoMessage = async (conversationId, senderId, mediaUrl) => {
  const conv = await conversationRepository.findById(conversationId);
  if (!conv) throw Object.assign(new Error('Conversation introuvable'), { statusCode: 404 });
  if (conv.status === 'blocked') throw Object.assign(new Error('Conversation bloquée'), { statusCode: 403 });

  if (conv.started_at) {
    const expiresAt = new Date(conv.started_at);
    expiresAt.setDate(expiresAt.getDate() + 7);
    if (new Date() > expiresAt) {
      throw Object.assign(new Error('Conversation expirée'), { statusCode: 403 });
    }
  }

  if (conv.owner_id !== senderId && conv.anonymous_id !== senderId) {
    throw Object.assign(new Error('Non autorisé'), { statusCode: 403 });
  }

  const message = await messageRepository.createMessage({
    id: uuidv4(),
    conversation_id: conversationId,
    sender_id: senderId,
    content: '[video]',
    media_url: mediaUrl,
    media_type: 'video',
  });

  return message;
};

const sendImageMessage = async (conversationId, senderId, mediaUrl) => {
  const conv = await conversationRepository.findById(conversationId);
  if (!conv) throw Object.assign(new Error('Conversation introuvable'), { statusCode: 404 });
  if (conv.status === 'blocked') throw Object.assign(new Error('Conversation bloquée'), { statusCode: 403 });

  if (conv.started_at) {
    const expiresAt = new Date(conv.started_at);
    expiresAt.setDate(expiresAt.getDate() + 7);
    if (new Date() > expiresAt) {
      throw Object.assign(new Error('Conversation expirée'), { statusCode: 403 });
    }
  }

  if (conv.owner_id !== senderId && conv.anonymous_id !== senderId) {
    throw Object.assign(new Error('Non autorisé'), { statusCode: 403 });
  }

  const message = await messageRepository.createMessage({
    id: uuidv4(),
    conversation_id: conversationId,
    sender_id: senderId,
    content: '[image]',
    media_url: mediaUrl,
    media_type: 'image',
  });

  return message;
};

module.exports = {
  sendMessage,
  getMessages,
  deleteMessage,
  sendVideoMessage,
  sendImageMessage,
};
