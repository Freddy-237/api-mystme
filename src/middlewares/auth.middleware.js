const jwt = require('jsonwebtoken');
const env = require('../config/env');
const parseCookies = require('../utils/parseCookies');

const authMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization;

  let token;
  if (authHeader) {
    token = authHeader.split(' ')[1];
  }

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
