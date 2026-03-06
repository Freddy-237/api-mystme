const messageService = require('./message.service');
const { getIO } = require('../../config/socket');
const logger = require('../../utils/logger');
const conversationRepository = require('../conversation/conversation.repository');
const identityRepository = require('../identity/identity.repository');
const { sendPushToUser } = require('../../services/push.service');
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

/**
 * If this is the first message in the conversation, set started_at and
 * notify both participants via a new_conversation socket event.
 */
const activateConversationIfNeeded = async (conversationId) => {
  try {
    const updated = await conversationRepository.setStartedAt(conversationId);
    if (updated) {
      const io = getIO();
      io.to(`user:${updated.owner_id}`).emit('new_conversation', updated);
      io.to(`user:${updated.anonymous_id}`).emit('new_conversation', updated);
    }
  } catch (_) {}
};

const notifyRecipient = async ({ conversationId, senderId, preview }) => {
  try {
    const conv = await conversationRepository.findById(conversationId);
    if (!conv) return;

    const recipientId = conv.owner_id === senderId ? conv.anonymous_id : conv.owner_id;
    if (!recipientId) return;

    const sender = await identityRepository.findById(senderId);
    const senderName = sender?.pseudo || 'Anonyme';

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

    const message = await messageService.sendMessage(
      conversationId,
      req.user.id,
      content,
      replyToMessageId
    );

    // Set started_at on first message & notify both participants about the new conv
    await activateConversationIfNeeded(conversationId);

    // Emit to the conversation room via Socket.io
    try {
      const io = getIO();
      io.to(conversationId).emit('new_message', message);
      const recipientId = await resolveRecipientId(conversationId, req.user.id);
      if (recipientId) {
        io.to(`user:${recipientId}`).emit('new_message', message);
      }
    } catch (_) {
      // Socket not initialized — skip
    }

    await notifyRecipient({
      conversationId,
      senderId: req.user.id,
      preview: content.length > 80 ? `${content.slice(0, 80)}…` : content,
    });

    res.status(201).json(message);
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
  video: { uploadFn: uploadToCloudinaryVideo, serviceFn: 'sendVideoMessage', fieldLabel: 'vidéo', preview: '🎥 Vidéo reçue' },
  image: { uploadFn: uploadToCloudinaryImage, serviceFn: 'sendImageMessage', fieldLabel: 'image', preview: '🖼️ Image reçue' },
  file:  { uploadFn: uploadToCloudinaryFile,  serviceFn: 'sendFileMessage',  fieldLabel: 'fichier', preview: '📎 Fichier reçu' },
  audio: { uploadFn: uploadToCloudinaryAudio, serviceFn: 'sendAudioMessage', fieldLabel: 'audio', preview: '🎤 Audio reçu' },
};

const createMediaHandler = (mediaType) => {
  const { uploadFn, serviceFn, fieldLabel, preview } = MEDIA_CONFIG[mediaType];
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

      let mediaUrl;
      try {
        mediaUrl = await uploadFn(file.buffer, conversationId);
        logger.info(
          { mediaType, conversationId, userId: req.user.id, mediaUrl },
          'messageController.createMediaHandler:upload-ok',
        );
      } catch (uploadErr) {
        logger.error({ err: uploadErr, mediaType, conversationId }, 'Cloudinary upload failed');
        return res.status(502).json({ message: `Upload ${fieldLabel} échoué`, detail: uploadErr.message });
      }
      const message = await messageService[serviceFn](conversationId, req.user.id, mediaUrl);
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

      await activateConversationIfNeeded(conversationId);
      logger.info(
        { mediaType, conversationId, userId: req.user.id },
        'messageController.createMediaHandler:conversation-activated',
      );

      try {
        const io = getIO();
        io.to(conversationId).emit('new_message', message);
        const recipientId = await resolveRecipientId(conversationId, req.user.id);
        if (recipientId) {
          io.to(`user:${recipientId}`).emit('new_message', message);
        }
      } catch (_) {}

      await notifyRecipient({ conversationId, senderId: req.user.id, preview });
      logger.info(
        { mediaType, conversationId, userId: req.user.id, messageId: message?.id },
        'messageController.createMediaHandler:done',
      );

      res.status(201).json(message);
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
