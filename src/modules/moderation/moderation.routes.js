const express = require('express');
const router = express.Router();
const moderationController = require('./moderation.controller');
const authMiddleware = require('../../middlewares/auth.middleware');
const moderationAuthMiddleware = require('../../middlewares/moderationAuth.middleware');
const createRateLimit = require('../../middlewares/rateLimit.middleware');

// Same convention as app.js: no IP rate limiting under test.
const isTest = process.env.NODE_ENV === 'test';

// The console is protected by a single shared key: cap guesses per IP.
const moderationLimiter = isTest ? (_req, _res, next) => next() : createRateLimit('http:moderation:console', {
  windowMs: 60 * 1000,
  maxRequests: 30,
});
const reportLimiter = isTest ? (_req, _res, next) => next() : createRateLimit('http:moderation:report', {
  windowMs: 60 * 1000,
  maxRequests: 10,
  message: 'Trop de signalements, réessaie dans une minute.',
});

// POST /moderation/report — report a message or conversation
router.post('/report', reportLimiter, authMiddleware, moderationController.reportMessage);
router.get('/reports', moderationLimiter, moderationAuthMiddleware, moderationController.listReports);
router.post('/report/:id/review', moderationLimiter, moderationAuthMiddleware, moderationController.reviewReport);

module.exports = router;
