const express = require('express');
const router = express.Router();
const { body, param } = require('express-validator');
const conversationController = require('./conversation.controller');
const authMiddleware = require('../../middlewares/auth.middleware');
const validate = require('../../middlewares/validate.middleware');

// POST /conversation/start — start conversation via invite code
router.post(
  '/start',
  authMiddleware,
  body('inviteCode').isString().trim().notEmpty().withMessage('inviteCode requis'),
  validate,
  conversationController.startConversation,
);

// POST /conversation/resolve-link — create/get conversation from invite code and return deeplink context
router.post(
  '/resolve-link',
  authMiddleware,
  body('inviteCode').isString().trim().notEmpty().withMessage('inviteCode requis'),
  validate,
  conversationController.resolveLink,
);

// GET /conversation/mine — get my conversations
router.get('/mine', authMiddleware, conversationController.getMyConversations);

// GET /conversation/:id — get single conversation
router.get(
  '/:id',
  authMiddleware,
  param('id').isUUID().withMessage('id invalide'),
  validate,
  conversationController.getConversation,
);

// POST /conversation/:id/block — block conversation
router.post(
  '/:id/block',
  authMiddleware,
  param('id').isUUID().withMessage('id invalide'),
  validate,
  conversationController.blockConversation,
);

// POST /conversation/:id/archive — archive conversation
router.post(
  '/:id/archive',
  authMiddleware,
  param('id').isUUID().withMessage('id invalide'),
  validate,
  conversationController.archiveConversation,
);

// DELETE /conversation/:id — soft-delete conversation
router.delete(
  '/:id',
  authMiddleware,
  param('id').isUUID().withMessage('id invalide'),
  validate,
  conversationController.deleteConversation,
);

// POST /conversation/:id/read — mark conversation as read
router.post(
  '/:id/read',
  authMiddleware,
  param('id').isUUID().withMessage('id invalide'),
  validate,
  conversationController.markAsRead,
);

module.exports = router;
