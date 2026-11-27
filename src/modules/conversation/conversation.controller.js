const conversationService = require('./conversation.service');
const { getIO } = require('../../config/socket');
const logger = require('../../utils/logger');
const { conversationForViewer } = require('../../utils/participantMask');

const notifyOwnerIfActive = (conversation) => {
  if (!conversation?.started_at) return;
  try {
    getIO()
      .to(`user:${conversation.owner_id}`)
      .emit('new_conversation', conversationForViewer(conversation, conversation.owner_id));
  } catch (err) {
    logger.warn({ err }, 'socket emit failed for new_conversation');
  }
};

const startConversation = async (req, res, next) => {
  try {
    const { inviteCode } = req.body;
    if (!inviteCode) return res.status(400).json({ message: 'inviteCode requis' });

    const conversation = await conversationService.startConversation(inviteCode, req.user.id);

    // The owner is notified on the first message (see message.controller),
    // not when the link is merely opened. Re-opening an already active
    // conversation refreshes it on the owner's side.
    notifyOwnerIfActive(conversation);

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

    notifyOwnerIfActive(result.conversation);

    res.json(result);
  } catch (error) {
    next(error);
  }
};

const findByInvite = async (req, res, next) => {
  try {
    res.json(await conversationService.findExistingByInvite(req.params.code, req.user.id));
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
    const limit = req.query.limit != null ? Number(req.query.limit) : undefined;
    const offset = req.query.offset != null ? Number(req.query.offset) : undefined;
    const conversations = await conversationService.getMyConversations(req.user.id, {
      limit,
      offset,
    });
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
  findByInvite,
  getConversation,
  getMyConversations,
  blockConversation,
  archiveConversation,
  deleteConversation,
  markAsRead,
};
