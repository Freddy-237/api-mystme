const { randomUUID: uuidv4 } = require('crypto');
const identityRepository = require('./identity.repository');
const generatePseudo = require('../../utils/generatePseudo');
const generateAvatar = require('../../utils/generateAvatar');
const generateToken = require('../../utils/generateToken');
const AppError = require('../../utils/AppError');

const initIdentity = async () => {
  const id = uuidv4();
  const anonymousUid = uuidv4();
  const pseudo = generatePseudo();
  const avatar = generateAvatar(pseudo);

  const user = await identityRepository.createUser({
    id,
    anonymous_uid: anonymousUid,
    pseudo,
    avatar_url: avatar,
  });

  const token = generateToken(user.id);

  return { user, token };
};

const getMe = async (userId) => {
  const user = await identityRepository.findById(userId);
  if (!user) throw new AppError('Utilisateur introuvable', 404);
  await identityRepository.updateLastSeen(userId);
  return user;
};

/**
 * Regenerate pseudo + avatar for a user.
 * If pseudo is provided, use it; otherwise generate a new one.
 */
const updatePseudo = async (userId, pseudo) => {
  const user = await identityRepository.findById(userId);
  if (!user) throw new AppError('Utilisateur introuvable', 404);

  const newPseudo = pseudo || generatePseudo();
  const newAvatar = generateAvatar(newPseudo);

  const updated = await identityRepository.updatePseudoAndAvatar(userId, newPseudo, newAvatar);
  return updated;
};

/**
 * Update the user's bio text.
 */
const updateBio = async (userId, bio) => {
  const user = await identityRepository.findById(userId);
  if (!user) throw new AppError('Utilisateur introuvable', 404);

  const trimmed = (bio || '').slice(0, 120);
  const updated = await identityRepository.updateBio(userId, trimmed);
  return updated;
};

const updatePushToken = async (userId, token) => {
  const user = await identityRepository.findById(userId);
  if (!user) throw new AppError('Utilisateur introuvable', 404);

  const cleanToken = (token || '').trim();
  if (!cleanToken) {
    throw new AppError('Token push invalide', 400);
  }

  const updated = await identityRepository.updatePushToken(userId, cleanToken);
  return updated;
};

const issueSessionToken = async (userId) => {
  const user = await identityRepository.findById(userId);
  if (!user) throw new AppError('Utilisateur introuvable', 404);

  const token = generateToken(user.id);
  return { token };
};

module.exports = {
  initIdentity,
  getMe,
  updatePseudo,
  updateBio,
  updatePushToken,
  issueSessionToken,
};
