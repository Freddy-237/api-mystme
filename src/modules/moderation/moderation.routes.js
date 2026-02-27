const express = require('express');
const router = express.Router();
const moderationController = require('./moderation.controller');
const authMiddleware = require('../../middlewares/auth.middleware');

// POST /moderation/report — report a message or conversation
router.post('/report', authMiddleware, moderationController.reportMessage);

module.exports = router;
