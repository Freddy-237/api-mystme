const env = require('../config/env');
const parseCookies = require('../utils/parseCookies');
const { extractBearerToken } = require('../utils/authToken');
const { authenticateToken } = require('../modules/identity/identity.auth');

const authMiddleware = async (req, res, next) => {
  let token = extractBearerToken(req.headers.authorization);

  if (!token) {
    const cookies = parseCookies(req.headers.cookie);
    token = cookies[env.authCookieName];
  }

  // `code` lets clients distinguish "your session is dead" from business 401s
  // (e.g. wrong OTP), so they never wipe a valid session by mistake.
  if (!token) {
    return res.status(401).json({
      error: true,
      code: 'AUTH_REQUIRED',
      message: 'Authentification requise',
      requestId: req.requestId,
    });
  }

  try {
    const user = await authenticateToken(token);
    req.user = { id: user.id };
    next();
  } catch (error) {
    // Infrastructure failures (DB down…) are NOT auth failures: answering 401
    // would make clients believe their session is dead and wipe it.
    if (error?.name !== 'AppError') {
      return res.status(503).json({
        error: true,
        code: 'SERVICE_UNAVAILABLE',
        message: 'Le service est temporairement indisponible. Réessaie plus tard.',
        requestId: req.requestId,
      });
    }
    const statusCode = error.statusCode || 401;
    return res.status(statusCode).json({
      error: true,
      code: error.code || (statusCode === 403 ? 'ACCOUNT_BANNED' : 'AUTH_INVALID'),
      message: error.message || 'Session expirée ou invalide',
      requestId: req.requestId,
    });
  }
};

module.exports = authMiddleware;
