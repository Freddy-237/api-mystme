const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const identityController = require('./identity.controller');
const transferController = require('../transfer/transfer.controller');
const authMiddleware = require('../../middlewares/auth.middleware');
const createRateLimit = require('../../middlewares/rateLimit.middleware');
const validate = require('../../middlewares/validate.middleware');

// ── Rate limiters for sensitive endpoints ────────────────────────────────────
const recoveryLimiter = createRateLimit('http:identity:recovery', {
  windowMs: 60 * 60 * 1000, // 1 hour
	maxRequests: 5,
	message: 'Trop de tentatives de récupération, réessaie dans une heure.',
});

const otpRequestLimiter = createRateLimit('http:identity:otp-request', {
  windowMs: 15 * 60 * 1000, // 15 minutes
	maxRequests: 5,
	message: 'Trop de demandes OTP, réessaie dans 15 minutes.',
});

const otpVerifyLimiter = createRateLimit('http:identity:otp-verify', {
  windowMs: 15 * 60 * 1000, // 15 minutes
	maxRequests: 10,
	message: 'Trop de tentatives de vérification, réessaie dans 15 minutes.',
});

// Per-email limiter: IP limits alone are weak (IP rotation), so also cap how
// many codes can be requested for one email address.
const otpPerEmailLimiter = createRateLimit('http:identity:otp-email', {
	windowMs: 15 * 60 * 1000,
	maxRequests: 3,
	keyGenerator: (req) => String(req.body?.email || '').trim().toLowerCase() || req.ip,
	message: 'Trop de codes demandés pour cet email, réessaie dans 15 minutes.',
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
	otpPerEmailLimiter,
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

// ── PWA → app transfer ───────────────────────────────────────────────────────
const transferCreateLimiter = createRateLimit('http:identity:transfer-create', {
	windowMs: 15 * 60 * 1000,
	maxRequests: 10,
	message: 'Trop de codes demandés, réessaie dans 15 minutes.',
});
const transferClaimIpLimiter = createRateLimit('http:identity:transfer-claim-ip', {
	windowMs: 15 * 60 * 1000,
	maxRequests: 15,
	message: 'Trop de tentatives, réessaie dans 15 minutes.',
});
const transferClaimUserLimiter = createRateLimit('http:identity:transfer-claim-user', {
	windowMs: 15 * 60 * 1000,
	maxRequests: 10,
	keyGenerator: (req) => req.user?.id || req.ip,
	message: 'Trop de tentatives, réessaie dans 15 minutes.',
});

// POST /identity/transfer-token — (web identity) get a one-time transfer code
router.post(
	'/transfer-token',
	transferCreateLimiter,
	authMiddleware,
	transferController.createTransferCode,
);

// POST /identity/transfer/claim — (app identity) absorb a web identity
router.post(
	'/transfer/claim',
	transferClaimIpLimiter,
	authMiddleware,
	transferClaimUserLimiter,
	body('code').isString().trim().isLength({ min: 8, max: 32 }).withMessage('code de transfert invalide'),
	validate,
	transferController.claimTransferCode,
);

// DELETE /identity/me — permanently delete the account and all its data
const deleteAccountLimiter = createRateLimit('http:identity:delete', {
	windowMs: 60 * 60 * 1000,
	maxRequests: 5,
	message: 'Trop de tentatives, réessaie plus tard.',
});
router.delete('/me', deleteAccountLimiter, authMiddleware, identityController.deleteAccount);

// GET /identity/csrf — refresh CSRF token cookie for current session
router.get('/csrf', authMiddleware, identityController.refreshCsrf);

// POST /identity/logout — clear auth cookie/session
router.post('/logout', authMiddleware, identityController.logout);

module.exports = router;
