const express = require('express');
const router = express.Router();
const linkController = require('./link.controller');
const authMiddleware = require('../../middlewares/auth.middleware');

// POST /link — create a new shareable link
router.post('/', authMiddleware, linkController.createLink);

// GET /link/code/:code — resolve an invite code (public)
router.get('/code/:code', linkController.getLinkByCode);

// GET /link/mine — get my links
router.get('/mine', authMiddleware, linkController.getMyLinks);

// DELETE /link/:id — deactivate a link
router.delete('/:id', authMiddleware, linkController.deactivateLink);

module.exports = router;
