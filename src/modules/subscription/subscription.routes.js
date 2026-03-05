const express = require('express');
const router = express.Router();
const controller = require('./subscription.controller');
const authMiddleware = require('../../middlewares/auth.middleware');

// All subscription routes require authentication
router.use(authMiddleware);

// POST /subscription/verify — validate & store a subscription purchase
router.post('/verify', controller.verifySubscription);

// POST /subscription/unlock — validate & store a single-conversation unlock
router.post('/unlock', controller.verifyUnlock);

// GET /subscription/status — check if current user has premium
router.get('/status', controller.getStatus);

// GET /subscription/unlock/:conversationId — check if conversation is unlocked
router.get('/unlock/:conversationId', controller.getUnlockStatus);

module.exports = router;
