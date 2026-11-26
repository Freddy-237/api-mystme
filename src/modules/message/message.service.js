const { randomUUID: uuidv4 } = require('crypto');
const messageRepository = require('./message.repository');
const conversationRepository = require('../conversation/conversation.repository');
const identityRepository = require('../identity/identity.repository');
const {
  ORIGINS,
  WEB_MESSAGE_LIMIT,
  isWebLocked,
} = require('../../config/webTrial');
const AppError = require('../../utils/AppError');
const logger = require('../../utils/logger');
const { messageForViewer } = require('../../utils/participantMask');
const { deleteMedia } = require('../../services/upload.service');

const persistMessageWithConversationState = async ({
  conversationId,
  senderId,
  content,
  replyToMessageId,
  mediaUrl,
  mediaType,
}) => {
  const conversation = await assertConversationWritable(conversationId, senderId);

  if (replyToMessageId) {
    const target = await messageRepository.findById(replyToMessageId);
    if (!target || target.conversation_id !== conversationId || target.is_deleted) {
      throw new AppError('Message de réponse invalide', 400);
    }
  }

  const result = await messageRepository.createMessageWithConversationState({
    id: uuidv4(),
    conversation_id: conversationId,
    sender_id: senderId,
    content,
    media_url: mediaUrl,
    media_type: mediaType,
    reply_to_message_id: replyToMessageId,
  });
  // `message` holds REAL participant ids: callers must pass it through
  // messageForViewer() (see utils/participantMask) before sending it to a client.
  return { ...result, conversation };
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
    throw new AppError('Conversation bloquée', 403, 'CONVERSATION_BLOCKED');
  }

  // Conversations never expire. Only web (PWA) identities are restricted:
  // read-only after their 7-day window, and capped in messages per
  // conversation — both enforced here so no client can bypass them.
  const sender = await identityRepository.findAccessStateById(senderId);
  if (sender?.origin === ORIGINS.WEB) {
    if (isWebLocked(sender)) {
      throw new AppError(
        'Ta période web est terminée. Télécharge l\'app pour continuer la conversation.',
        403,
        'WEB_TRIAL_EXPIRED',
      );
    }

    const sentCount = await messageRepository.countBySenderInConversation(conversationId, senderId);
    if (sentCount >= WEB_MESSAGE_LIMIT) {
      throw new AppError(
        'Limite de messages web atteinte. Télécharge l\'app pour continuer.',
        403,
        'WEB_MESSAGE_LIMIT',
      );
    }
  }

  logger.info({ conversationId, senderId }, 'assertConversationWritable:ok');
  return conv;
};

const createMediaMessage = async (conversationId, senderId, mediaUrl, mediaType, content) => {
  logger.info(
    { conversationId, senderId, mediaType },
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
    { conversationId, senderId, mediaType },
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
  const conv = await assertConversationParticipant(conversationId, userId);

  const rows = await messageRepository.findByConversation(conversationId, userId, limit, offset);
  return rows.map((row) => messageForViewer(row, conv, userId));
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

  // The file goes too — unless the message is under a pending report: then
  // it is kept as evidence until a moderator has looked at it.
  if (msg.media_url) {
    const underReview = await messageRepository.hasPendingReport(messageId);
    if (!underReview) {
      await messageRepository.clearMedia(messageId);
      deleteMedia([{ media_url: msg.media_url, media_type: msg.media_type }])
        .catch((error) => logger.warn({ err: error, messageId }, 'deleted message media cleanup failed'));
    }
  }

  const conv = await conversationRepository.findById(deleted.conversation_id);
  return messageForViewer(deleted, conv, userId);
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
  const conv = await assertConversationParticipant(conversationId, userId);
  const rows = await messageRepository.searchByConversation(conversationId, userId, searchTerm, limit, offset);
  return rows.map((row) => messageForViewer(row, conv, userId));
};

const getMedia = async (conversationId, userId, mediaType, limit, offset) => {
  const conv = await assertConversationParticipant(conversationId, userId);
  const rows = await messageRepository.findMediaByConversation(conversationId, userId, mediaType, limit, offset);
  return rows.map((row) => messageForViewer(row, conv, userId));
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
  assertConversationWritable,
  searchMessages,
  getMedia,
};
