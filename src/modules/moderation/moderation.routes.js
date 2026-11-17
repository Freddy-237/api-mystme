const express = require('express');
const router = express.Router();
const moderationController = require('./moderation.controller');
const authMiddleware = require('../../middlewares/auth.middleware');
const createRateLimit = require('../../middlewares/rateLimit.middleware');

// Same convention as app.js: no IP rate limiting under test.
const isTest = process.env.NODE_ENV === 'test';

const reportLimiter = isTest ? (_req, _res, next) => next() : createRateLimit('http:moderation:report', {
  windowMs: 60 * 1000,
  maxRequests: 10,
  message: 'Trop de signalements, réessaie dans une minute.',
});

// POST /moderation/report — report a message or conversation
router.post('/report', reportLimiter, authMiddleware, moderationController.reportMessage);
// Reviewing reports happens in the back-office (/admin, individual accounts,
// 2FA, audit log). The former shared-key console routes are gone.

module.exports = router;
