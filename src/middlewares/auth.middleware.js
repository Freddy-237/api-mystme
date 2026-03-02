const jwt = require('jsonwebtoken');
const env = require('../config/env');
const parseCookies = require('../utils/parseCookies');
const { extractBearerToken } = require('../utils/authToken');

const authMiddleware = (req, res, next) => {
  let token = extractBearerToken(req.headers.authorization);

  if (!token) {
    const cookies = parseCookies(req.headers.cookie);
    token = cookies[env.authCookieName];
  }

  if (!token) {
    return res.status(401).json({ message: 'Token manquant' });
  }

  try {
    const decoded = jwt.verify(token, env.jwtSecret);
    req.user = { id: decoded.userId };
    next();
  } catch (error) {
    return res.status(401).json({ message: 'Token expiré ou invalide' });
  }
};

module.exports = authMiddleware;
