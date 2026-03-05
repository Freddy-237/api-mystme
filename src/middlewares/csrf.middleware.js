const env = require('../config/env');
const parseCookies = require('../utils/parseCookies');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
// Paths exempt from CSRF (registration-like endpoints where there is no
// authenticated session to protect)
const CSRF_EXEMPT_PATHS = new Set(['/identity/init', '/identity/logout']);

const csrfMiddleware = (req, res, next) => {
  if (SAFE_METHODS.has(req.method)) return next();

  // Skip CSRF for endpoints that create or destroy sessions
  if (CSRF_EXEMPT_PATHS.has(req.path)) return next();

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
