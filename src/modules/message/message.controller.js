const messageService = require('./message.service');
const { getIO } = require('../../config/socket');
const cloudinary = require('../../config/cloudinary');
const conversationRepository = require('../conversation/conversation.repository');
const identityRepository = require('../identity/identity.repository');
const { sendPushToUser } = require('../../services/push.service');

const uploadToCloudinaryVideo = (buffer, conversationId) =>
  new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: 'mystme/messages/videos',
        resource_type: 'video',
        public_id: `${conversationId}_${Date.now()}`,
      },
      (error, result) => {
        if (error || !result) return reject(error || new Error('Upload Cloudinary échoué'));
        resolve(result.secure_url);
      }
    );
    stream.end(buffer);
  });

const uploadToCloudinaryImage = (buffer, conversationId) =>
  new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: 'mystme/messages/images',
        resource_type: 'image',
        public_id: `${conversationId}_${Date.now()}`,
      },
      (error, result) => {
        if (error || !result) return reject(error || new Error('Upload Cloudinary échoué'));
        resolve(result.secure_url);
      }
    );
    stream.end(buffer);
  });

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
    const { conversationId, content } = req.body;
    if (!conversationId || !content) {
      return res.status(400).json({ message: 'conversationId et content requis' });
    }

    const message = await messageService.sendMessage(conversationId, req.user.id, content);

    // Emit to the conversation room via Socket.io
    try {
      const io = getIO();
      io.to(conversationId).emit('new_message', message);
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

const deleteMessage = async (req, res, next) => {
  try {
    const msg = await messageService.deleteMessage(req.params.id, req.user.id);

    // Notify conversation room that a message was deleted
    try {
      const io = getIO();
      io.to(msg.conversation_id).emit('message_deleted', { id: msg.id, conversationId: msg.conversation_id });
    } catch (_) {}

    res.json(msg);
  } catch (error) {
    next(error);
  }
};

const sendVideo = async (req, res, next) => {
  try {
    const { conversationId } = req.body;
    const file = req.file;

    if (!conversationId || !file) {
      return res.status(400).json({ message: 'conversationId et vidéo requis' });
    }

    const mediaUrl = await uploadToCloudinaryVideo(file.buffer, conversationId);
    const message = await messageService.sendVideoMessage(
      conversationId,
      req.user.id,
      mediaUrl
    );

    try {
      const io = getIO();
      io.to(conversationId).emit('new_message', message);
    } catch (_) {}

    await notifyRecipient({
      conversationId,
      senderId: req.user.id,
      preview: '🎥 Vidéo reçue',
    });

    res.status(201).json(message);
  } catch (error) {
    next(error);
  }
};

const sendImage = async (req, res, next) => {
  try {
    const { conversationId } = req.body;
    const file = req.file;

    if (!conversationId || !file) {
      return res.status(400).json({ message: 'conversationId et image requis' });
    }

    const mediaUrl = await uploadToCloudinaryImage(file.buffer, conversationId);
    const message = await messageService.sendImageMessage(
      conversationId,
      req.user.id,
      mediaUrl
    );

    try {
      const io = getIO();
      io.to(conversationId).emit('new_message', message);
    } catch (_) {}

    await notifyRecipient({
      conversationId,
      senderId: req.user.id,
      preview: '🖼️ Image reçue',
    });

    res.status(201).json(message);
  } catch (error) {
    next(error);
  }
};

module.exports = {
  sendMessage,
  getMessages,
  deleteMessage,
  sendVideo,
  sendImage,
};
