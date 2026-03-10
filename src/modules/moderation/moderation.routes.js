const express = require('express');
const router = express.Router();
const moderationController = require('./moderation.controller');
const authMiddleware = require('../../middlewares/auth.middleware');
const moderationAuthMiddleware = require('../../middlewares/moderationAuth.middleware');

// POST /moderation/report — report a message or conversation
router.post('/report', authMiddleware, moderationController.reportMessage);
router.get('/reports', moderationAuthMiddleware, moderationController.listReports);
router.post('/report/:id/review', moderationAuthMiddleware, moderationController.reviewReport);

module.exports = router;
