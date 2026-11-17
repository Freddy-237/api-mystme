const distributedRateLimitStore = require('../utils/distributedRateLimitStore');
const logger = require('../utils/logger');

// Never read X-Forwarded-For directly: its leftmost entries are client-controlled.
// With `app.set('trust proxy', 1)`, Express resolves req.ip from the entry
// appended by our single trusted proxy (Railway edge), which cannot be spoofed.
const getDefaultKey = (req) => req.ip || req.socket?.remoteAddress || 'unknown';

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
        const normalizedMessage = typeof message === 'string'
          ? message
          : message?.message;

        return res.status(429).json({
          error: true,
          message: normalizedMessage || 'Trop de requêtes. Réessaie plus tard.',
          requestId: req.requestId,
        });
      }

      next();
    } catch (error) {
      logger.error({ err: error, scope, path: req.path }, 'http rate-limit failed open');
      next();
    }
  };
};

module.exports = createRateLimit;
module.exports.getDefaultKey = getDefaultKey;
