const { randomUUID: uuidv4 } = require('crypto');
const crypto = require('crypto');
const identityRepository = require('./identity.repository');
const generatePseudo = require('../../utils/generatePseudo');
const generateAvatar = require('../../utils/generateAvatar');
const generateToken = require('../../utils/generateToken');
const AppError = require('../../utils/AppError');

const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const RECOVERY_RAW_LENGTH = 20;

const hashRecoveryKey = (value) =>
  crypto.createHash('sha256').update(value).digest('hex');

const normalizeRecoveryKey = (value) =>
  String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');

const formatRecoveryKey = (raw) =>
  raw.match(/.{1,5}/g)?.join('-') || raw;

const createRecoveryKey = () => {
  const bytes = crypto.randomBytes(RECOVERY_RAW_LENGTH);
  let out = '';
  for (let i = 0; i < RECOVERY_RAW_LENGTH; i++) {
    out += RECOVERY_ALPHABET[bytes[i] % RECOVERY_ALPHABET.length];
  }
  return out;
};

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

const generateRecoveryKey = async (userId) => {
  const user = await identityRepository.findById(userId);
  if (!user) throw new AppError('Utilisateur introuvable', 404);

  const rawKey = createRecoveryKey();
  const keyHash = hashRecoveryKey(rawKey);
  await identityRepository.updateRecoveryKeyHash(userId, keyHash);

  return {
    recoveryKey: formatRecoveryKey(rawKey),
    issuedAt: new Date().toISOString(),
  };
};

const restoreByRecoveryKey = async (recoveryKey) => {
  const normalized = normalizeRecoveryKey(recoveryKey);
  if (normalized.length < 12) {
    throw new AppError('Clé de récupération invalide', 400);
  }

  const keyHash = hashRecoveryKey(normalized);
  const user = await identityRepository.findByRecoveryKeyHash(keyHash);
  if (!user) throw new AppError('Clé de récupération invalide', 401);

  await identityRepository.updateLastSeen(user.id);
  const token = generateToken(user.id);
  return { user, token };
};

module.exports = {
  initIdentity,
  getMe,
  updatePseudo,
  updateBio,
  updatePushToken,
  issueSessionToken,
  generateRecoveryKey,
  restoreByRecoveryKey,
};
