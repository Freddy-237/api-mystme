const { randomUUID: uuidv4 } = require('crypto');
const messageRepository = require('./message.repository');
const conversationRepository = require('../conversation/conversation.repository');
const subscriptionService = require('../subscription/subscription.service');

const assertConversationParticipant = async (conversationId, userId) => {
  const conv = await conversationRepository.findById(conversationId);
  if (!conv) throw Object.assign(new Error('Conversation introuvable'), { statusCode: 404 });
  if (conv.owner_id !== userId && conv.anonymous_id !== userId) {
    throw Object.assign(new Error('Non autorisé'), { statusCode: 403 });
  }
  return conv;
};

const assertConversationWritable = async (conversationId, senderId) => {
  const conv = await assertConversationParticipant(conversationId, senderId);
  if (conv.status === 'blocked') {
    throw Object.assign(new Error('Conversation bloquée'), { statusCode: 403 });
  }

  if (conv.started_at != null) {
    const expiresAt = new Date(conv.started_at);
    expiresAt.setDate(expiresAt.getDate() + 7);
    if (new Date() > expiresAt) {
      // Premium users or single-unlock buyers can bypass expiry.
      const unlocked = await subscriptionService.isConversationUnlocked(senderId, conversationId);
      if (!unlocked) {
        throw Object.assign(new Error('Conversation expirée'), { statusCode: 403 });
      }
    }
  }

  return conv;
};

const createMediaMessage = async (conversationId, senderId, mediaUrl, mediaType, content) => {
  await assertConversationWritable(conversationId, senderId);
  return messageRepository.createMessage({
    id: uuidv4(),
    conversation_id: conversationId,
    sender_id: senderId,
    content,
    media_url: mediaUrl,
    media_type: mediaType,
  });
};

const sendMessage = async (conversationId, senderId, content, replyToMessageId) => {
  await assertConversationWritable(conversationId, senderId);

  if (replyToMessageId) {
    const target = await messageRepository.findById(replyToMessageId);
    if (!target || target.conversation_id !== conversationId || target.is_deleted) {
      throw Object.assign(new Error('Message de réponse invalide'), { statusCode: 400 });
    }
  }

  const message = await messageRepository.createMessage({
    id: uuidv4(),
    conversation_id: conversationId,
    sender_id: senderId,
    content,
    reply_to_message_id: replyToMessageId,
  });

  return message;
};

const getMessages = async (conversationId, userId, limit, offset) => {
  await assertConversationParticipant(conversationId, userId);

  return messageRepository.findByConversation(conversationId, userId, limit, offset);
};

const hideMessageForMe = async (messageId, userId) => {
  const msg = await messageRepository.findById(messageId);
  if (!msg) throw Object.assign(new Error('Message introuvable'), { statusCode: 404 });

  await assertConversationParticipant(msg.conversation_id, userId);

  await messageRepository.hideMessageForUser(messageId, userId);
};

const unhideMessageForMe = async (messageId, userId) => {
  const msg = await messageRepository.findById(messageId);
  if (!msg) throw Object.assign(new Error('Message introuvable'), { statusCode: 404 });

  await assertConversationParticipant(msg.conversation_id, userId);

  await messageRepository.unhideMessageForUser(messageId, userId);
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
  return createMediaMessage(conversationId, senderId, mediaUrl, 'video', '[video]');
};

const sendImageMessage = async (conversationId, senderId, mediaUrl) => {
  return createMediaMessage(conversationId, senderId, mediaUrl, 'image', '[image]');
};

const sendFileMessage = async (conversationId, senderId, mediaUrl) => {
  return createMediaMessage(conversationId, senderId, mediaUrl, 'file', '[file]');
};

const sendAudioMessage = async (conversationId, senderId, mediaUrl) => {
  return createMediaMessage(conversationId, senderId, mediaUrl, 'audio', '[audio]');
};

const searchMessages = async (conversationId, userId, searchTerm, limit, offset) => {
  await assertConversationParticipant(conversationId, userId);
  return messageRepository.searchByConversation(conversationId, userId, searchTerm, limit, offset);
};

const getMedia = async (conversationId, userId, mediaType, limit, offset) => {
  await assertConversationParticipant(conversationId, userId);
  return messageRepository.findMediaByConversation(conversationId, userId, mediaType, limit, offset);
};

module.exports = {
  sendMessage,
  getMessages,
  deleteMessage,
  hideMessageForMe,
  unhideMessageForMe,
  sendVideoMessage,
  sendImageMessage,
  sendFileMessage,
  sendAudioMessage,
  searchMessages,
  getMedia,
};
