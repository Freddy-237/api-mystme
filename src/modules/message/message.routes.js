const express = require('express');
const router = express.Router();
const { body, param, query } = require('express-validator');
const multer = require('multer');
const messageController = require('./message.controller');
const authMiddleware = require('../../middlewares/auth.middleware');
const validate = require('../../middlewares/validate.middleware');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

// POST /message — send a message
router.post(
  '/',
  authMiddleware,
  body('conversationId').isUUID().withMessage('conversationId invalide'),
  body('content').isString().trim().isLength({ min: 1, max: 5000 }).withMessage('Contenu requis (max 5000 car.'),
  validate,
  messageController.sendMessage,
);

// POST /message/video — upload a video message to Cloudinary
router.post(
  '/video',
  authMiddleware,
  upload.single('video'),
  (req, res, next) => {
    if (!req.file || !req.file.mimetype.startsWith('video/')) {
      return res.status(400).json({ message: 'Fichier vidéo invalide' });
    }
    next();
  },
  body('conversationId').isUUID().withMessage('conversationId invalide'),
  validate,
  messageController.sendVideo,
);

// POST /message/image — upload an image message to Cloudinary
router.post(
  '/image',
  authMiddleware,
  upload.single('image'),
  (req, res, next) => {
    if (!req.file || !req.file.mimetype.startsWith('image/')) {
      return res.status(400).json({ message: 'Fichier image invalide' });
    }
    next();
  },
  body('conversationId').isUUID().withMessage('conversationId invalide'),
  validate,
  messageController.sendImage,
);

// GET /message/:conversationId — get messages for a conversation
router.get(
  '/:conversationId',
  authMiddleware,
  param('conversationId').isUUID().withMessage('conversationId invalide'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('limit: 1-100'),
  query('offset').optional().isInt({ min: 0 }).withMessage('offset >= 0'),
  validate,
  messageController.getMessages,
);

// DELETE /message/:id — soft-delete a message
router.delete(
  '/:id',
  authMiddleware,
  param('id').isUUID().withMessage('id invalide'),
  validate,
  messageController.deleteMessage,
);

module.exports = router;
