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

  if (!token) {
    return res.status(401).json({ message: 'Token manquant' });
  }

  try {
    const user = await authenticateToken(token);
    req.user = { id: user.id };
    next();
  } catch (error) {
    return res.status(error.statusCode || 401).json({ message: error.message || 'Token expiré ou invalide' });
  }
};

module.exports = authMiddleware;
