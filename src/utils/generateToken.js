const jwt = require('jsonwebtoken');
const env = require('../config/env');

/**
 * Generate a JWT token for an anonymous user.
 * @param {string} userId
 * @param {number} [sessionVersion] — the user's current session_version
 * @returns {string} signed JWT
 */
const generateToken = (userId, sessionVersion = 0) => {
  return jwt.sign(
    // sv = users.session_version at issue time (see identity.auth.js).
    { userId, sv: Number(sessionVersion) || 0 },
    env.jwtSecret,
    { expiresIn: '30d' }
  );
};

module.exports = generateToken;
