const env = require('../config/env');

const moderationAuthMiddleware = (req, res, next) => {
  if (!env.moderationApiKey) {
    return res.status(503).json({
      error: true,
      message: 'Service de modération indisponible',
      requestId: req.requestId,
    });
  }

  const providedKey = req.headers['x-moderation-api-key'];
  if (!providedKey || providedKey !== env.moderationApiKey) {
    return res.status(401).json({
      error: true,
      message: 'Clé API de modération invalide',
      requestId: req.requestId,
    });
  }

  req.moderatorActor = typeof req.headers['x-moderation-actor'] === 'string'
    ? req.headers['x-moderation-actor'].trim().slice(0, 100)
    : 'system';

  next();
};

module.exports = moderationAuthMiddleware;