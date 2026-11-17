const messageService = require('./message.service');
const { getIO } = require('../../config/socket');
const logger = require('../../utils/logger');
const conversationRepository = require('../conversation/conversation.repository');
const { sendPushToUser } = require('../../services/push.service');
const {
  conversationForViewer,
  messageForViewer,
  emitToParticipants,
} = require('../../utils/participantMask');
const {
  uploadVideo: uploadToCloudinaryVideo,
  uploadImage: uploadToCloudinaryImage,
  uploadFile: uploadToCloudinaryFile,
  uploadAudio: uploadToCloudinaryAudio,
} = require('../../services/upload.service');

const resolveRecipientId = async (conversationId, senderId) => {
  const conv = await conversationRepository.findById(conversationId);
  if (!conv) return null;
  return conv.owner_id === senderId ? conv.anonymous_id : conv.owner_id;
};

// Each participant gets the payload they are allowed to see: the link owner
// never receives the anonymous participant's real id (utils/participantMask).
const emitNewConversationIfNeeded = async (conversation) => {
  try {
    if (conversation) {
      emitToParticipants(getIO(), conversation, 'new_conversation', (viewerId) =>
        conversationForViewer(conversation, viewerId));
    }
  } catch (_) {}
};

const emitNewMessage = (conversation, message) => {
  try {
    emitToParticipants(getIO(), conversation, 'new_message', (viewerId) =>
      messageForViewer(message, conversation, viewerId));
  } catch (_) {
    // Socket not initialized — skip
  }
};

const notifyRecipient = async ({ conversationId, senderId, preview }) => {
  try {
    const conv = await conversationRepository.findById(conversationId);
    if (!conv) return;

    const recipientId = conv.owner_id === senderId ? conv.anonymous_id : conv.owner_id;
    if (!recipientId) return;

    // Never the sender's global pseudo: an anonymous sender is announced under
    // the alias of THIS conversation, otherwise the push would unmask them.
    const senderName = senderId === conv.anonymous_id
      ? (conv.anonymous_alias || 'Anonyme')
      : (conv.owner_pseudo || 'Anonyme');

    await sendPushToUser({
      userId: recipientId,
      title: `Nouveau message de ${senderName}`,
      body: preview,
      data: {
        conversationId,
        type: 'message',
      },
    });
  } catch (_) {}
};

const sendMessage = async (req, res, next) => {
  try {
    const { conversationId, content, replyToMessageId } = req.body;
    if (!conversationId || !content) {
      return res.status(400).json({ message: 'conversationId et content requis' });
    }

    const { message, activatedConversation, conversation } = await messageService.sendMessageWithConversationState(
      conversationId,
      req.user.id,
      content,
      replyToMessageId
    );

    await emitNewConversationIfNeeded(activatedConversation);
    emitNewMessage(conversation, message);

    await notifyRecipient({
      conversationId,
      senderId: req.user.id,
      preview: content.length > 80 ? `${content.slice(0, 80)}…` : content,
    });

    res.status(201).json(messageForViewer(message, conversation, req.user.id));
  } catch (error) {
    next(error);
  }
};

const getMessages = async (req, res, next) => {
  try {
    const { limit = 50, offset = 0 } = req.query;
    const messages = await messageService.getMessages(
      req.params.conversationId,
      req.user.id,
      parseInt(limit),
      parseInt(offset)
    );
    res.json(messages);
  } catch (error) {
    next(error);
  }
};

const searchMessages = async (req, res, next) => {
  try {
    const { q, limit = 30, offset = 0 } = req.query;
    if (!q || !q.trim()) {
      return res.status(400).json({ message: 'Le paramètre q est requis' });
    }
    const messages = await messageService.searchMessages(
      req.params.conversationId,
      req.user.id,
      q.trim(),
      parseInt(limit),
      parseInt(offset)
    );
    res.json(messages);
  } catch (error) {
    next(error);
  }
};

const getMedia = async (req, res, next) => {
  try {
    const { type, limit = 50, offset = 0 } = req.query;
    const messages = await messageService.getMedia(
      req.params.conversationId,
      req.user.id,
      type || null,
      parseInt(limit),
      parseInt(offset)
    );
    res.json(messages);
  } catch (error) {
    next(error);
  }
};

const deleteMessage = async (req, res, next) => {
  try {
    const msg = await messageService.deleteMessage(req.params.id, req.user.id);

    // Notify conversation room that a message was deleted
    try {
      const io = getIO();
      io.to(msg.conversation_id).emit('message_deleted', { id: msg.id, conversationId: msg.conversation_id });
      const recipientId = await resolveRecipientId(msg.conversation_id, msg.sender_id);
      if (recipientId) {
        io.to(`user:${recipientId}`).emit('message_deleted', {
          id: msg.id,
          conversationId: msg.conversation_id,
        });
      }
    } catch (_) {}

    res.json(msg);
  } catch (error) {
    next(error);
  }
};

const hideMessageForMe = async (req, res, next) => {
  try {
    await messageService.hideMessageForMe(req.params.id, req.user.id);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
};

const unhideMessageForMe = async (req, res, next) => {
  try {
    await messageService.unhideMessageForMe(req.params.id, req.user.id);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
};

// ---------------------------------------------------------------------------
// Generic media upload factory — replaces 4 near-identical handlers
// ---------------------------------------------------------------------------

const MEDIA_CONFIG = {
  video: { uploadFn: uploadToCloudinaryVideo, fieldLabel: 'vidéo', preview: '🎥 Vidéo reçue' },
  image: { uploadFn: uploadToCloudinaryImage, fieldLabel: 'image', preview: '🖼️ Image reçue' },
  file:  { uploadFn: uploadToCloudinaryFile, fieldLabel: 'fichier', preview: '📎 Fichier reçu' },
  audio: { uploadFn: uploadToCloudinaryAudio, fieldLabel: 'audio', preview: '🎤 Audio reçu' },
};

const createMediaHandler = (mediaType) => {
  const { uploadFn, fieldLabel, preview } = MEDIA_CONFIG[mediaType];
  return async (req, res, next) => {
    try {
      const { conversationId } = req.body;
      const file = req.file;
      logger.info(
        {
          mediaType,
          conversationId,
          userId: req.user?.id,
          hasFile: !!file,
          mimetype: file?.mimetype,
          originalname: file?.originalname,
          size: file?.size,
        },
        'messageController.createMediaHandler:start',
      );

      if (!conversationId || !file) {
        return res.status(400).json({ message: `conversationId et ${fieldLabel} requis` });
      }

      // Authorize BEFORE uploading: otherwise anyone could push files to our
      // Cloudinary account for conversations they are not part of.
      await messageService.assertConversationWritable(conversationId, req.user.id);

      let mediaUrl;
      try {
        mediaUrl = await uploadFn(file.buffer, conversationId);
        logger.info(
          { mediaType, conversationId, userId: req.user.id, mediaUrl },
          'messageController.createMediaHandler:upload-ok',
        );
      } catch (uploadErr) {
        logger.error({ err: uploadErr, mediaType, conversationId }, 'Cloudinary upload failed');
        return res.status(502).json({ message: `Upload ${fieldLabel} échoué` });
      }
      const { message, activatedConversation, conversation } = await messageService.createMediaMessageWithConversationState(
        conversationId,
        req.user.id,
        mediaUrl,
        mediaType,
        MEDIA_CONFIG[mediaType].preview,
      );
      logger.info(
        {
          mediaType,
          conversationId,
          userId: req.user.id,
          messageId: message?.id,
          mediaTypeSaved: message?.media_type,
        },
        'messageController.createMediaHandler:message-created',
      );

      await emitNewConversationIfNeeded(activatedConversation);
      logger.info(
        { mediaType, conversationId, userId: req.user.id },
        'messageController.createMediaHandler:conversation-activated',
      );

      emitNewMessage(conversation, message);

      await notifyRecipient({ conversationId, senderId: req.user.id, preview });
      logger.info(
        { mediaType, conversationId, userId: req.user.id, messageId: message?.id },
        'messageController.createMediaHandler:done',
      );

      res.status(201).json(messageForViewer(message, conversation, req.user.id));
    } catch (error) {
      logger.error(
        {
          err: error,
          mediaType,
          conversationId: req.body?.conversationId,
          userId: req.user?.id,
          hasFile: !!req.file,
        },
        'messageController.createMediaHandler:unhandled-error',
      );
      next(error);
    }
  };
};

const sendVideo = createMediaHandler('video');
const sendImage = createMediaHandler('image');
const sendFile = createMediaHandler('file');
const sendAudio = createMediaHandler('audio');

module.exports = {
  sendMessage,
  getMessages,
  searchMessages,
  getMedia,
  deleteMessage,
  hideMessageForMe,
  unhideMessageForMe,
  sendVideo,
  sendImage,
  sendFile,
  sendAudio,
};
