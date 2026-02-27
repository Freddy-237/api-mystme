const env = require('../config/env');
const parseCookies = require('../utils/parseCookies');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const csrfMiddleware = (req, res, next) => {
  if (SAFE_METHODS.has(req.method)) return next();

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return next();
  }

  const cookies = parseCookies(req.headers.cookie);
  const authCookie = cookies[env.authCookieName];
  if (!authCookie) return next();

  const csrfCookie = cookies[env.csrfCookieName];
  const csrfHeader = req.headers[env.csrfHeaderName.toLowerCase()];

  if (!csrfCookie || !csrfHeader || csrfCookie !== csrfHeader) {
    return res.status(403).json({
      error: true,
      message: 'CSRF token invalide',
    });
  }

  return next();
};

module.exports = csrfMiddleware;
