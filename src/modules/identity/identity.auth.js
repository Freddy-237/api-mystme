const jwt = require('jsonwebtoken');
const env = require('../../config/env');
const AppError = require('../../utils/AppError');
const identityRepository = require('./identity.repository');

const BANNED_ACCOUNT_MESSAGE = 'Compte suspendu';

const assertUserIsActive = (user) => {
  if (!user) {
    throw new AppError('Utilisateur introuvable', 404);
  }
  if (user.is_banned) {
    throw new AppError(BANNED_ACCOUNT_MESSAGE, 403);
  }
  return user;
};

const requireActiveUserById = async (userId) => {
  const user = await identityRepository.findAuthStateById(userId);
  return assertUserIsActive(user);
};

const authenticateToken = async (token) => {
  let decoded;

  try {
    decoded = jwt.verify(token, env.jwtSecret);
  } catch (_) {
    throw new AppError('Token expiré ou invalide', 401);
  }

  const user = await requireActiveUserById(decoded.userId);
  return {
    id: user.id,
    isBanned: !!user.is_banned,
  };
};

module.exports = {
  BANNED_ACCOUNT_MESSAGE,
  assertUserIsActive,
  requireActiveUserById,
  authenticateToken,
};