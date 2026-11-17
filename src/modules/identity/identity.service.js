const { randomUUID: uuidv4 } = require('crypto');
const crypto = require('crypto');
const identityRepository = require('./identity.repository');
const moderationRepository = require('../moderation/moderation.repository');
const generatePseudo = require('../../utils/generatePseudo');
const generateAvatar = require('../../utils/generateAvatar');
const generateToken = require('../../utils/generateToken');
const AppError = require('../../utils/AppError');
const env = require('../../config/env');
const { sendOtpEmail, hasEmailConfig } = require('../../services/mail.service');
const { requireActiveUserById } = require('./identity.auth');
const withTransaction = require('../../utils/withTransaction');
const {
  ORIGINS,
  computeWebExpiresAt,
  computeWebPurgeAt,
  isWebLocked,
} = require('../../config/webTrial');

const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const RECOVERY_RAW_LENGTH = 20;
const OTP_TTL_MINUTES = 10;
const OTP_MAX_ATTEMPTS = 5;

// Whitelist of user fields a client may see. push_token, recovery_key_hash,
// ban and tier internals stay server-side.
const PUBLIC_USER_FIELDS = [
  'id',
  'anonymous_uid',
  'pseudo',
  'avatar_url',
  'bio',
  'email',
  'email_verified_at',
  'notifications_enabled',
  'origin',
  'web_expires_at',
  'last_seen_at',
  'created_at',
];

const toPublicUser = (user) => {
  if (!user) return user;
  const out = {};
  for (const field of PUBLIC_USER_FIELDS) {
    if (user[field] !== undefined) out[field] = user[field];
  }
  // Derived web-trial state so clients never re-implement the rules.
  if (user.origin !== undefined) {
    const isWeb = user.origin === ORIGINS.WEB;
    out.web_locked = isWebLocked(user);
    out.web_purge_at = isWeb ? computeWebPurgeAt(user.web_expires_at) : null;
  }
  return out;
};

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

const normalizeEmail = (email) => String(email || '').trim().toLowerCase();

const isValidEmail = (email) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());

const generateOtpCode = () => {
  const num = crypto.randomInt(0, 1000000);
  return String(num).padStart(6, '0');
};

/**
 * @param {{ origin?: 'web'|'app' }} [options] — 'web' for the PWA (7-day
 *   write window), anything else is an app identity (never expires).
 */
const initIdentity = async ({ origin } = {}) => {
  const normalizedOrigin = origin === ORIGINS.WEB ? ORIGINS.WEB : ORIGINS.APP;
  const id = uuidv4();
  const anonymousUid = uuidv4();
  const pseudo = generatePseudo();
  const avatar = generateAvatar(pseudo);

  const user = await identityRepository.createUser({
    id,
    anonymous_uid: anonymousUid,
    pseudo,
    avatar_url: avatar,
    origin: normalizedOrigin,
    web_expires_at: normalizedOrigin === ORIGINS.WEB ? computeWebExpiresAt() : null,
  });

  const token = generateToken(user.id);

  return { user: toPublicUser(user), token };
};

const getMe = async (userId) => {
  const user = await identityRepository.findById(userId);
  if (!user) throw new AppError('Utilisateur introuvable', 404);
  await identityRepository.updateLastSeen(userId);

  const signalSummary = await moderationRepository.getUserSignalSummary(userId);
  return {
    ...toPublicUser(user),
    system_warning_message: signalSummary.auto_flagged
      ? 'Avertissement du système: plusieurs signalements récents ont été détectés sur votre compte. Merci de respecter les règles de la communauté.'
      : null,
    system_warning_code: signalSummary.auto_flagged
      ? 'moderation-threshold'
      : null,
  };
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
  return toPublicUser(updated);
};

/**
 * Update the user's bio text.
 */
const updateBio = async (userId, bio) => {
  const user = await identityRepository.findById(userId);
  if (!user) throw new AppError('Utilisateur introuvable', 404);

  const trimmed = (bio || '').slice(0, 120);
  const updated = await identityRepository.updateBio(userId, trimmed);
  return toPublicUser(updated);
};

const updateNotificationPreference = async (userId, enabled) => {
  const user = await identityRepository.findById(userId);
  if (!user) throw new AppError('Utilisateur introuvable', 404);
  if (typeof enabled !== 'boolean') {
    throw new AppError('Préférence de notification invalide', 400);
  }

  const updated = await identityRepository.updateNotificationPreference(
    userId,
    enabled,
  );
  return toPublicUser(updated);
};

const updatePushToken = async (userId, token) => {
  const user = await identityRepository.findById(userId);
  if (!user) throw new AppError('Utilisateur introuvable', 404);

  const cleanToken = (token || '').trim();
  if (!cleanToken) {
    throw new AppError('Token push invalide', 400);
  }

  const updated = await identityRepository.updatePushToken(userId, cleanToken);
  return toPublicUser(updated);
};

const issueSessionToken = async (userId) => {
  const user = await requireActiveUserById(userId);

  const token = generateToken(user.id, user.session_version);
  return { token };
};

/** Log out everywhere: every token issued so far stops working. */
const logout = async (userId) => {
  await identityRepository.bumpSessionVersion(userId);
};

/**
 * Permanently delete the account and everything attached to it.
 * @returns {{ userIds: string[], conversationIds: string[], media: object[], peers: object[] }}
 */
const deleteAccount = async (userId) => {
  const result = await withTransaction((client) =>
    identityRepository.deleteAccountData(client, userId));
  if (!result) throw new AppError('Utilisateur introuvable', 404);
  return result;
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
  // baseUserSelect has no ban columns: check ban state explicitly.
  const authState = await requireActiveUserById(user.id);

  await identityRepository.updateLastSeen(user.id);
  const token = generateToken(user.id, authState.session_version);
  return { user: toPublicUser(user), token };
};

/**
 * Shared OTP check: existence, expiry, attempts, hash, atomic consumption.
 * Wrong codes are counted; after OTP_MAX_ATTEMPTS the code is burned.
 */
const verifyOtpOrThrow = async (otp, normalizedEmail, code) => {
  // Missing code answers like a wrong code: no hint about account existence.
  if (!otp) throw new AppError('Code OTP invalide', 400);
  if (Number(otp.failed_attempts || 0) >= OTP_MAX_ATTEMPTS) {
    throw new AppError('Trop de tentatives. Demande un nouveau code.', 429);
  }
  if (otp.consumed_at) throw new AppError('Code OTP déjà utilisé', 409);
  if (new Date(otp.expires_at).getTime() < Date.now()) {
    throw new AppError('Code OTP expiré', 410);
  }

  const cleanCode = String(code || '').trim();
  const expectedHash = hashRecoveryKey(`${normalizedEmail}:${cleanCode}`);
  const matches = expectedHash.length === otp.code_hash.length
    && crypto.timingSafeEqual(Buffer.from(expectedHash), Buffer.from(otp.code_hash));

  if (!matches) {
    const attempts = await identityRepository.registerFailedOtpAttempt(otp.id, OTP_MAX_ATTEMPTS);
    if (attempts >= OTP_MAX_ATTEMPTS) {
      throw new AppError('Trop de tentatives. Demande un nouveau code.', 429);
    }
    throw new AppError('Code OTP invalide', 400);
  }

  const consumed = await identityRepository.consumeEmailOtp(otp.id);
  if (!consumed) throw new AppError('Code OTP déjà utilisé', 409);
};

const requestEmailOtp = async (userId, email) => {
  const user = await identityRepository.findById(userId);
  if (!user) throw new AppError('Utilisateur introuvable', 404);

  const normalizedEmail = normalizeEmail(email);
  if (!isValidEmail(normalizedEmail)) {
    throw new AppError('Email invalide', 400);
  }

  if (env.isProduction && !hasEmailConfig()) {
    throw new AppError('Service email indisponible', 503);
  }

  const existing = await identityRepository.findByEmail(normalizedEmail);
  if (existing && existing.id !== userId) {
    throw new AppError('Cet email est déjà utilisé', 409);
  }

  const code = generateOtpCode();
  const codeHash = hashRecoveryKey(`${normalizedEmail}:${code}`);
  const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);

  await identityRepository.createEmailOtp({
    id: uuidv4(),
    userId,
    email: normalizedEmail,
    codeHash,
    expiresAt,
  });

  const mailResult = await sendOtpEmail({
    to: normalizedEmail,
    code,
    pseudo: user.pseudo,
  });

  const payload = {
    ok: true,
    email: normalizedEmail,
    expiresAt: expiresAt.toISOString(),
    delivery: mailResult.sent ? 'sent' : 'debug',
  };

  if (!env.isProduction && !mailResult.sent) {
    payload.debugOtp = code;
  }

  return payload;
};

const verifyEmailOtp = async (userId, email, code) => {
  const normalizedEmail = normalizeEmail(email);
  if (!isValidEmail(normalizedEmail)) {
    throw new AppError('Email invalide', 400);
  }

  const latestOtp = await identityRepository.findLatestEmailOtp({
    userId,
    email: normalizedEmail,
  });
  await verifyOtpOrThrow(latestOtp, normalizedEmail, code);

  const user = await identityRepository.setVerifiedEmail({
    userId,
    email: normalizedEmail,
  });

  return {
    ok: true,
    user: toPublicUser(user),
  };
};

/**
 * Request OTP for unauthenticated email-based restore.
 * Only works if the email is already verified on an existing account.
 */
const requestEmailRestore = async (email) => {
  const normalizedEmail = normalizeEmail(email);
  if (!isValidEmail(normalizedEmail)) {
    throw new AppError('Email invalide', 400);
  }

  if (env.isProduction && !hasEmailConfig()) {
    throw new AppError('Service email indisponible', 503);
  }

  const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);
  // Same answer whether or not the email exists, so this endpoint cannot be
  // used to discover which emails have an account.
  const genericPayload = {
    ok: true,
    email: normalizedEmail,
    expiresAt: expiresAt.toISOString(),
  };

  const user = await identityRepository.findByEmail(normalizedEmail);
  if (!user || !user.email_verified_at) {
    return { ...genericPayload, delivery: 'sent' };
  }

  const code = generateOtpCode();
  const codeHash = hashRecoveryKey(`${normalizedEmail}:${code}`);

  await identityRepository.createEmailOtp({
    id: uuidv4(),
    userId: user.id,
    email: normalizedEmail,
    codeHash,
    expiresAt,
    purpose: 'restore',
  });

  const mailResult = await sendOtpEmail({
    to: normalizedEmail,
    code,
    pseudo: user.pseudo,
  });

  const payload = {
    ...genericPayload,
    delivery: mailResult.sent ? 'sent' : 'debug',
  };

  if (!env.isProduction && !mailResult.sent) {
    payload.debugOtp = code;
  }

  return payload;
};

/**
 * Verify OTP and restore account session (unauthenticated).
 */
const verifyEmailRestore = async (email, code) => {
  const normalizedEmail = normalizeEmail(email);
  if (!isValidEmail(normalizedEmail)) {
    throw new AppError('Email invalide', 400);
  }

  const latestOtp = await identityRepository.findLatestEmailOtpByEmail(normalizedEmail);
  await verifyOtpOrThrow(latestOtp, normalizedEmail, code);

  const user = await identityRepository.findByEmail(normalizedEmail);
  if (!user) throw new AppError('Utilisateur introuvable', 404);
  const authState = await requireActiveUserById(user.id);

  await identityRepository.updateLastSeen(user.id);
  const token = generateToken(user.id, authState.session_version);
  return { user: toPublicUser(user), token };
};

module.exports = {
  OTP_MAX_ATTEMPTS,
  toPublicUser,
  initIdentity,
  getMe,
  updatePseudo,
  updateBio,
  updateNotificationPreference,
  updatePushToken,
  issueSessionToken,
  logout,
  deleteAccount,
  generateRecoveryKey,
  restoreByRecoveryKey,
  requestEmailOtp,
  verifyEmailOtp,
  requestEmailRestore,
  verifyEmailRestore,
};
