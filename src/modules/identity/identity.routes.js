const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const rateLimit = require('express-rate-limit');
const identityController = require('./identity.controller');
const authMiddleware = require('../../middlewares/auth.middleware');
const validate = require('../../middlewares/validate.middleware');

// ── Rate limiters for sensitive endpoints ────────────────────────────────────
const recoveryLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  message: { error: 'Trop de tentatives de récupération, réessaye dans une heure' },
  standardHeaders: true,
  legacyHeaders: false,
});

const otpRequestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  message: { error: 'Trop de demandes OTP, réessaye dans 15 minutes' },
  standardHeaders: true,
  legacyHeaders: false,
});

const otpVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  message: { error: 'Trop de tentatives de vérification, réessaye dans 15 minutes' },
  standardHeaders: true,
  legacyHeaders: false,
});

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
	recoveryLimiter,
	body('recoveryKey').isString().trim().isLength({ min: 12 }).withMessage('recoveryKey invalide'),
	validate,
	identityController.restoreByRecoveryKey
);

// POST /identity/email/request-otp — send OTP to email for account linking
router.post(
	'/email/request-otp',
	otpRequestLimiter,
	authMiddleware,
	body('email').isEmail().withMessage('email invalide'),
	validate,
	identityController.requestEmailOtp,
);

// POST /identity/email/verify-otp — verify OTP and mark email as verified
router.post(
	'/email/verify-otp',
	otpVerifyLimiter,
	authMiddleware,
	body('email').isEmail().withMessage('email invalide'),
	body('code').isLength({ min: 4, max: 8 }).withMessage('code OTP invalide'),
	validate,
	identityController.verifyEmailOtp,
);

// PATCH /identity/pseudo — regenerate pseudo + avatar
router.patch('/pseudo', authMiddleware, identityController.updatePseudo);

// PATCH /identity/bio — update bio text
router.patch('/bio', authMiddleware, identityController.updateBio);

// PATCH /identity/notifications — update notification preference
router.patch(
	'/notifications',
	authMiddleware,
	body('enabled')
		.custom((value) => typeof value === 'boolean')
		.withMessage('enabled invalide'),
	validate,
	identityController.updateNotificationPreference,
);

// PATCH /identity/push-token — register/update FCM device token
router.patch(
	'/push-token',
	authMiddleware,
	body('token').isString().trim().notEmpty().withMessage('token push requis'),
	validate,
	identityController.updatePushToken
);

// POST /identity/email/restore/request-otp — (unauthenticated) send OTP for email-based restore
router.post(
	'/email/restore/request-otp',
	otpRequestLimiter,
	body('email').isEmail().withMessage('email invalide'),
	validate,
	identityController.requestEmailRestore,
);

// POST /identity/email/restore/verify-otp — (unauthenticated) verify OTP and restore account
router.post(
	'/email/restore/verify-otp',
	recoveryLimiter,
	body('email').isEmail().withMessage('email invalide'),
	body('code').isLength({ min: 4, max: 8 }).withMessage('code OTP invalide'),
	validate,
	identityController.verifyEmailRestore,
);

// GET /identity/csrf — refresh CSRF token cookie for current session
router.get('/csrf', authMiddleware, identityController.refreshCsrf);

// POST /identity/logout — clear auth cookie/session
router.post('/logout', authMiddleware, identityController.logout);

module.exports = router;
