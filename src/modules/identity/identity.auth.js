const jwt = require('jsonwebtoken');
const env = require('../../config/env');
const AppError = require('../../utils/AppError');
const identityRepository = require('./identity.repository');

const BANNED_ACCOUNT_MESSAGE = 'Compte suspendu';

const assertUserIsActive = (user) => {
  // The account no longer exists (deleted, purged, or the app was reset):
  // answer like an expired session, so clients drop it and start afresh.
  // A 404 here would leave installed apps stuck on a dead session.
  if (!user) {
    throw new AppError('Session expirée ou invalide', 401, 'AUTH_INVALID');
  }
  if (user.is_banned) {
    throw new AppError(BANNED_ACCOUNT_MESSAGE, 403);
  }
  // A web identity transferred into the app: its old sessions are dead.
  if (user.merged_into_user_id) {
    throw new AppError('Cette session a été transférée vers l\'app MystMe', 401, 'IDENTITY_TRANSFERRED');
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
  // Tokens issued before a logout carry an older session version.
  if ((Number(decoded.sv) || 0) !== (Number(user.session_version) || 0)) {
    throw new AppError('Session expirée ou invalide', 401, 'AUTH_INVALID');
  }
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