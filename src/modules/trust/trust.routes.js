const express = require('express');
const router = express.Router();
const trustController = require('./trust.controller');
const authMiddleware = require('../../middlewares/auth.middleware');

// GET /trust/:conversationId — get trust level
router.get('/:conversationId', authMiddleware, trustController.getTrust);

// POST /trust/:conversationId/upgrade — upgrade trust level
router.post('/:conversationId/upgrade', authMiddleware, trustController.upgradeTrust);

module.exports = router;
