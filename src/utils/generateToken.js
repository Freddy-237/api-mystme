const jwt = require('jsonwebtoken');
const env = require('../config/env');

/**
 * Generate a JWT token for an anonymous user.
 * @param {string} userId
 * @returns {string} signed JWT
 */
const generateToken = (userId) => {
  return jwt.sign(
    { userId },
    env.jwtSecret,
    { expiresIn: '30d' }
  );
};

module.exports = generateToken;
