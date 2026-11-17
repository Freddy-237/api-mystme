const transferService = require('./transfer.service');
const conversationRepository = require('../conversation/conversation.repository');
const { getIO } = require('../../config/socket');
const logger = require('../../utils/logger');
const { conversationForViewer } = require('../../utils/participantMask');

const createTransferCode = async (req, res, next) => {
  try {
    const data = await transferService.createTransferCode(req.user.id);
    res.status(201).json(data);
  } catch (error) {
    next(error);
  }
};

const claimTransferCode = async (req, res, next) => {
  try {
    const data = await transferService.claimTransferCode(req.user.id, req.body.code);

    // Refresh both sides in real time: the app user gets the conversations,
    // owners see their correspondent's new participant id.
    try {
      const io = getIO();
      for (const conversationId of data.conversationIds) {
        const conversation = await conversationRepository.findById(conversationId);
        if (!conversation) continue;
        io.to(`user:${conversation.anonymous_id}`).emit('new_conversation', conversation);
        if (conversation.started_at) {
          io.to(`user:${conversation.owner_id}`).emit(
            'new_conversation',
            conversationForViewer(conversation, conversation.owner_id),
          );
        }
      }
    } catch (err) {
      logger.warn({ err }, 'transfer: realtime refresh skipped');
    }

    res.status(200).json(data);
  } catch (error) {
    next(error);
  }
};

module.exports = { createTransferCode, claimTransferCode };
