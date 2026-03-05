const express = require('express');
const router = express.Router();
const { body, param, query } = require('express-validator');
const multer = require('multer');
const messageController = require('./message.controller');
const authMiddleware = require('../../middlewares/auth.middleware');
const validate = require('../../middlewares/validate.middleware');

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
});

const withFile = (fieldName, isValidType, invalidMessage) => [
  upload.single(fieldName),
  (req, res, next) => {
    if (!req.file || !isValidType(req.file.mimetype)) {
      return res.status(400).json({ message: invalidMessage });
    }
    return next();
  },
];

// POST /message — send a message
router.post(
  '/',
  authMiddleware,
  body('conversationId').isUUID().withMessage('conversationId invalide'),
  body('content').isString().trim().isLength({ min: 1, max: 5000 }).withMessage('Contenu requis (max 5000 car.'),
  body('replyToMessageId').optional().isUUID().withMessage('replyToMessageId invalide'),
  validate,
  messageController.sendMessage,
);

// POST /message/video — upload a video message to Cloudinary
router.post(
  '/video',
  authMiddleware,
  ...withFile('video', (mimetype) => mimetype.startsWith('video/'), 'Fichier vidéo invalide'),
  body('conversationId').isUUID().withMessage('conversationId invalide'),
  validate,
  messageController.sendVideo,
);

// POST /message/image — upload an image message to Cloudinary
router.post(
  '/image',
  authMiddleware,
  ...withFile('image', (mimetype) => mimetype.startsWith('image/'), 'Fichier image invalide'),
  body('conversationId').isUUID().withMessage('conversationId invalide'),
  validate,
  messageController.sendImage,
);

// POST /message/file — upload a file message to Cloudinary
router.post(
  '/file',
  authMiddleware,
  ...withFile('file', (mimetype) => Boolean(mimetype), 'Fichier invalide'),
  body('conversationId').isUUID().withMessage('conversationId invalide'),
  validate,
  messageController.sendFile,
);

// POST /message/audio — upload an audio message to Cloudinary
router.post(
  '/audio',
  authMiddleware,
  ...withFile('audio', (mimetype) => mimetype.startsWith('audio/'), 'Fichier audio invalide'),
  body('conversationId').isUUID().withMessage('conversationId invalide'),
  validate,
  messageController.sendAudio,
);

// GET /message/:conversationId/search — search messages in a conversation
router.get(
  '/:conversationId/search',
  authMiddleware,
  param('conversationId').isUUID().withMessage('conversationId invalide'),
  query('q').isString().trim().isLength({ min: 1, max: 200 }).withMessage('q requis (1-200 car.)'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('limit: 1-100'),
  query('offset').optional().isInt({ min: 0 }).withMessage('offset >= 0'),
  validate,
  messageController.searchMessages,
);

// GET /message/:conversationId/media — get media messages for a conversation
router.get(
  '/:conversationId/media',
  authMiddleware,
  param('conversationId').isUUID().withMessage('conversationId invalide'),
  query('type').optional().isIn(['image', 'video', 'audio', 'file']).withMessage('type: image|video|audio|file'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('limit: 1-100'),
  query('offset').optional().isInt({ min: 0 }).withMessage('offset >= 0'),
  validate,
  messageController.getMedia,
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

// POST /message/:id/hide — hide message only for current user
router.post(
  '/:id/hide',
  authMiddleware,
  param('id').isUUID().withMessage('id invalide'),
  validate,
  messageController.hideMessageForMe,
);

// POST /message/:id/unhide — unhide message for current user
router.post(
  '/:id/unhide',
  authMiddleware,
  param('id').isUUID().withMessage('id invalide'),
  validate,
  messageController.unhideMessageForMe,
);

module.exports = router;
