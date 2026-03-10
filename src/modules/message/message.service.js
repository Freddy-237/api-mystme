const { randomUUID: uuidv4 } = require('crypto');
const messageRepository = require('./message.repository');
const conversationRepository = require('../conversation/conversation.repository');
const {
  isConversationExpired,
} = require('../conversation/conversation.expiry');
const subscriptionService = require('../subscription/subscription.service');
const AppError = require('../../utils/AppError');
const logger = require('../../utils/logger');

const persistMessageWithConversationState = async ({
  conversationId,
  senderId,
  content,
  replyToMessageId,
  mediaUrl,
  mediaType,
}) => {
  await assertConversationWritable(conversationId, senderId);

  if (replyToMessageId) {
    const target = await messageRepository.findById(replyToMessageId);
    if (!target || target.conversation_id !== conversationId || target.is_deleted) {
      throw new AppError('Message de réponse invalide', 400);
    }
  }

  return messageRepository.createMessageWithConversationState({
    id: uuidv4(),
    conversation_id: conversationId,
    sender_id: senderId,
    content,
    media_url: mediaUrl,
    media_type: mediaType,
    reply_to_message_id: replyToMessageId,
  });
};

const assertConversationParticipant = async (conversationId, userId) => {
  logger.info({ conversationId, userId }, 'assertConversationParticipant:start');
  const conv = await conversationRepository.findById(conversationId);
  if (!conv) throw new AppError('Conversation introuvable', 404);
  if (conv.owner_id !== userId && conv.anonymous_id !== userId) {
    throw new AppError('Non autorisé', 403);
  }
  logger.info(
    {
      conversationId,
      userId,
      ownerId: conv.owner_id,
      anonymousId: conv.anonymous_id,
      status: conv.status,
      startedAt: conv.started_at,
    },
    'assertConversationParticipant:ok',
  );
  return conv;
};

const assertConversationWritable = async (conversationId, senderId) => {
  const conv = await assertConversationParticipant(conversationId, senderId);
  logger.info(
    {
      conversationId,
      senderId,
      status: conv.status,
      startedAt: conv.started_at,
    },
    'assertConversationWritable:check',
  );
  if (conv.status === 'blocked') {
    throw new AppError('Conversation bloquée', 403);
  }

  if (conv.started_at != null) {
    if (isConversationExpired(conv.started_at)) {
      // Premium users or single-unlock buyers can bypass expiry.
      const unlocked = await subscriptionService.isConversationUnlocked(senderId, conversationId);
      logger.info(
        { conversationId, senderId, unlocked },
        'assertConversationWritable:expired-check',
      );
      if (!unlocked) {
        throw new AppError('Conversation expirée', 403);
      }
    }
  }

  logger.info({ conversationId, senderId }, 'assertConversationWritable:ok');
  return conv;
};

const createMediaMessage = async (conversationId, senderId, mediaUrl, mediaType, content) => {
  logger.info(
    { conversationId, senderId, mediaType, mediaUrl, content },
    'createMediaMessage:start',
  );
  const result = await persistMessageWithConversationState({
    conversationId,
    senderId,
    content,
    mediaUrl,
    mediaType,
  });
  logger.info(
    {
      conversationId,
      senderId,
      mediaType,
      messageId: result.message?.id,
      createdAt: result.message?.created_at,
    },
    'createMediaMessage:success',
  );
  return result.message;
};

const createMediaMessageWithConversationState = async (
  conversationId,
  senderId,
  mediaUrl,
  mediaType,
  content,
) => {
  logger.info(
    { conversationId, senderId, mediaType, mediaUrl, content },
    'createMediaMessageWithConversationState:start',
  );
  const result = await persistMessageWithConversationState({
    conversationId,
    senderId,
    content,
    mediaUrl,
    mediaType,
  });
  logger.info(
    {
      conversationId,
      senderId,
      mediaType,
      messageId: result.message?.id,
      activatedConversation: !!result.activatedConversation,
    },
    'createMediaMessageWithConversationState:success',
  );
  return result;
};

const sendMessage = async (conversationId, senderId, content, replyToMessageId) => {
  const result = await persistMessageWithConversationState({
    conversationId,
    senderId,
    content,
    replyToMessageId,
  });
  return result.message;
};

const sendMessageWithConversationState = async (conversationId, senderId, content, replyToMessageId) => {
  return persistMessageWithConversationState({
    conversationId,
    senderId,
    content,
    replyToMessageId,
  });
};

const getMessages = async (conversationId, userId, limit, offset) => {
  await assertConversationParticipant(conversationId, userId);

  return messageRepository.findByConversation(conversationId, userId, limit, offset);
};

const hideMessageForMe = async (messageId, userId) => {
  const msg = await messageRepository.findById(messageId);
  if (!msg) throw new AppError('Message introuvable', 404);

  await assertConversationParticipant(msg.conversation_id, userId);

  await messageRepository.hideMessageForUser(messageId, userId);
};

const unhideMessageForMe = async (messageId, userId) => {
  const msg = await messageRepository.findById(messageId);
  if (!msg) throw new AppError('Message introuvable', 404);

  await assertConversationParticipant(msg.conversation_id, userId);

  await messageRepository.unhideMessageForUser(messageId, userId);
};

const deleteMessage = async (messageId, userId) => {
  const msg = await messageRepository.findById(messageId);
  if (!msg) throw new AppError('Message introuvable', 404);
  if (msg.sender_id !== userId) {
    throw new AppError('Non autorisé — seul l\'auteur peut supprimer', 403);
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
  createMediaMessage,
  createMediaMessageWithConversationState,
  sendMessageWithConversationState,
  searchMessages,
  getMedia,
};
