const conversationService = require('./conversation.service');
const { getIO } = require('../../config/socket');
const logger = require('../../utils/logger');

const startConversation = async (req, res, next) => {
  try {
    const { inviteCode } = req.body;
    if (!inviteCode) return res.status(400).json({ message: 'inviteCode requis' });

    const conversation = await conversationService.startConversation(inviteCode, req.user.id);

    // Notify the link owner about the new conversation so the mobile app
    // refreshes its list instantly instead of waiting for the next poll.
    try {
      const io = getIO();
      const room = `user:${conversation.owner_id}`;
      const sockets = await io.in(room).fetchSockets();
      logger.info({
        event: 'new_conversation_emit',
        room,
        ownerId: conversation.owner_id,
        conversationId: conversation.id,
        socketsInRoom: sockets.length,
      }, 'emitting new_conversation');
      io.to(room).emit('new_conversation', conversation);
    } catch (err) {
      logger.error({ err }, 'socket emit failed for new_conversation');
    }

    res.status(201).json(conversation);
  } catch (error) {
    next(error);
  }
};

const resolveLink = async (req, res, next) => {
  try {
    const { inviteCode } = req.body;
    if (!inviteCode) return res.status(400).json({ message: 'inviteCode requis' });

    const result = await conversationService.resolveLink(inviteCode, req.user.id);

    // Notify the link owner about the new conversation (same as startConversation)
    try {
      const io = getIO();
      io.to(`user:${result.ownerId}`).emit('new_conversation', {
        id: result.conversationId,
        owner_id: result.ownerId,
      });
    } catch (_) {
      // Socket not initialized — skip
    }

    res.json(result);
  } catch (error) {
    next(error);
  }
};

const getConversation = async (req, res, next) => {
  try {
    const conv = await conversationService.getConversation(req.params.id, req.user.id);
    res.json(conv);
  } catch (error) {
    next(error);
  }
};

const getMyConversations = async (req, res, next) => {
  try {
    const conversations = await conversationService.getMyConversations(req.user.id);
    res.json(conversations);
  } catch (error) {
    next(error);
  }
};

const blockConversation = async (req, res, next) => {
  try {
    const result = await conversationService.blockConversation(req.params.id, req.user.id);
    res.json(result);
  } catch (error) {
    next(error);
  }
};

const archiveConversation = async (req, res, next) => {
  try {
    const result = await conversationService.archiveConversation(req.params.id, req.user.id);
    res.json(result);
  } catch (error) {
    next(error);
  }
};

const deleteConversation = async (req, res, next) => {
  try {
    const result = await conversationService.deleteConversation(req.params.id, req.user.id);
    res.json(result);
  } catch (error) {
    next(error);
  }
};

const markAsRead = async (req, res, next) => {
  try {
    const result = await conversationService.markAsRead(req.params.id, req.user.id);
    res.json(result);
  } catch (error) {
    next(error);
  }
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
