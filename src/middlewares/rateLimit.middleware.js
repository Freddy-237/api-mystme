const distributedRateLimitStore = require('../utils/distributedRateLimitStore');
const logger = require('../utils/logger');

const getDefaultKey = (req) => {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || 'unknown';
};

const createRateLimit = (
  scope,
  {
    windowMs = 60_000,
    maxRequests = 60,
    keyGenerator = getDefaultKey,
    message = 'Trop de requêtes, réessaye plus tard',
  } = {},
) => {
  return async (req, res, next) => {
    try {
      const rawKey = await Promise.resolve(keyGenerator(req));
      const key = String(rawKey || 'unknown');
      const result = await distributedRateLimitStore.consume({
        scope,
        key,
        windowMs,
        max: maxRequests,
      });

      res.setHeader('RateLimit-Limit', String(maxRequests));
      res.setHeader('RateLimit-Remaining', String(result.remaining));
      res.setHeader('RateLimit-Reset', String(Math.ceil(result.resetAt.getTime() / 1000)));

      if (!result.allowed) {
        return res.status(429).json({ message });
      }

      next();
    } catch (error) {
      logger.error({ err: error, scope, path: req.path }, 'http rate-limit failed open');
      next();
    }
  };
};

module.exports = createRateLimit;
