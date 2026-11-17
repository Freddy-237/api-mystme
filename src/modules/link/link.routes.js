const express = require('express');
const router = express.Router();
const linkController = require('./link.controller');
const authMiddleware = require('../../middlewares/auth.middleware');
const createRateLimit = require('../../middlewares/rateLimit.middleware');

// Same convention as app.js: no IP rate limiting under test.
const isTest = process.env.NODE_ENV === 'test';

// Invite codes are short: cap lookups per IP so they cannot be enumerated.
const resolveLimiter = isTest ? (_req, _res, next) => next() : createRateLimit('http:link:resolve', {
  windowMs: 60 * 1000,
  maxRequests: 30,
});

// POST /link — create a new shareable link
router.post('/', authMiddleware, linkController.createLink);

// GET /link/code/:code — resolve an invite code (public)
router.get('/code/:code', resolveLimiter, linkController.getLinkByCode);

// GET /link/mine — get my links
router.get('/mine', authMiddleware, linkController.getMyLinks);

// DELETE /link/:id — deactivate a link
router.delete('/:id', authMiddleware, linkController.deactivateLink);

module.exports = router;
