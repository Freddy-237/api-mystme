const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const identityController = require('./identity.controller');
const authMiddleware = require('../../middlewares/auth.middleware');
const validate = require('../../middlewares/validate.middleware');

// POST /identity/init — create anonymous user
router.post('/init', identityController.initIdentity);

// GET /identity/me — get current user (requires token)
router.get('/me', authMiddleware, identityController.getMe);

// GET /identity/session-token — issue a fresh bearer token for current session
router.get('/session-token', authMiddleware, identityController.issueSessionToken);

// POST /identity/recovery-key — generate a cross-device recovery key
router.post('/recovery-key', authMiddleware, identityController.createRecoveryKey);

// POST /identity/restore — restore an account using a recovery key
router.post(
	'/restore',
	body('recoveryKey').isString().trim().isLength({ min: 12 }).withMessage('recoveryKey invalide'),
	validate,
	identityController.restoreByRecoveryKey
);

// PATCH /identity/pseudo — regenerate pseudo + avatar
router.patch('/pseudo', authMiddleware, identityController.updatePseudo);

// PATCH /identity/bio — update bio text
router.patch('/bio', authMiddleware, identityController.updateBio);

// PATCH /identity/push-token — register/update FCM device token
router.patch(
	'/push-token',
	authMiddleware,
	body('token').isString().trim().notEmpty().withMessage('token push requis'),
	validate,
	identityController.updatePushToken
);

// GET /identity/csrf — refresh CSRF token cookie for current session
router.get('/csrf', authMiddleware, identityController.refreshCsrf);

// POST /identity/logout — clear auth cookie/session
router.post('/logout', authMiddleware, identityController.logout);

module.exports = router;
