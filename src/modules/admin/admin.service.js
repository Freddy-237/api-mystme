const { randomUUID } = require('crypto');
const jwt = require('jsonwebtoken');
const env = require('../../config/env');
const AppError = require('../../utils/AppError');
const repo = require('./admin.repository');
const c = require('./admin.crypto');

const ROLES = ['owner', 'moderator', 'support'];
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;
const CHALLENGE_TTL = '5m';
const SESSION_ABSOLUTE_MS = 8 * 60 * 60 * 1000; // 8 h
const SESSION_IDLE_MS = 30 * 60 * 1000; // 30 min without activity

const LOGIN_FAILED = () => new AppError('Email ou mot de passe incorrect', 401, 'ADMIN_LOGIN_FAILED');
const LOCKED = () => new AppError('Compte temporairement verrouillé après plusieurs échecs. Réessaie dans 15 minutes.', 423, 'ADMIN_LOCKED');

const normalizeEmail = (email) => String(email || '').trim().toLowerCase();

const isLocked = (admin) => !!admin.is_locked;

const signChallenge = (admin, setup) =>
  jwt.sign({ sub: admin.id, purpose: 'admin-2fa', setup: !!setup }, env.jwtSecret, {
    expiresIn: CHALLENGE_TTL,
    audience: 'mystme-admin-2fa',
  });

const readChallenge = (challenge) => {
  try {
    const payload = jwt.verify(String(challenge || ''), env.jwtSecret, { audience: 'mystme-admin-2fa' });
    if (payload.purpose !== 'admin-2fa') throw new Error('bad purpose');
    return payload;
  } catch {
    throw new AppError('Étape de connexion expirée, recommence', 401, 'ADMIN_CHALLENGE_INVALID');
  }
};

const toPublic = (admin) => ({
  id: admin.id,
  email: admin.email,
  displayName: admin.display_name,
  role: admin.role,
  mustChangePassword: !!admin.must_change_password,
  totpEnabled: admin.totp_enabled !== undefined ? !!admin.totp_enabled : !!admin.totp_secret_enc,
  isActive: admin.is_active !== false,
  lastLoginAt: admin.last_login_at || null,
  createdAt: admin.created_at || null,
});

const validatePassword = (password) => {
  if (typeof password !== 'string' || password.length < c.PASSWORD_MIN_LENGTH) {
    throw new AppError(`Le mot de passe doit faire au moins ${c.PASSWORD_MIN_LENGTH} caractères`, 400, 'ADMIN_WEAK_PASSWORD');
  }
  if (password.length > 200) throw new AppError('Mot de passe trop long', 400);
};

// ── Login, step 1: email + password ─────────────────────────────────────────
const login = async ({ email, password }) => {
  const admin = await repo.findByEmail(normalizeEmail(email));
  // Always run scrypt, even for an unknown email (same timing).
  const ok = await c.verifyPassword(password, admin ? admin.password_hash : null);

  if (!admin || !admin.is_active) throw LOGIN_FAILED();
  if (isLocked(admin)) throw LOCKED();
  if (!ok) {
    await repo.recordFailedLogin(admin.id, { maxAttempts: MAX_FAILED_ATTEMPTS, lockMinutes: LOCK_MINUTES });
    throw LOGIN_FAILED();
  }

  if (admin.totp_secret_enc) {
    return { admin, result: { step: 'totp', challenge: signChallenge(admin, false) } };
  }

  // First login (or 2FA reset): the admin must enrol an authenticator app.
  const secret = c.generateTotpSecret();
  await repo.setPendingTotp(admin.id, c.encryptSecret(secret));
  return {
    admin,
    result: {
      step: 'totp_setup',
      challenge: signChallenge(admin, true),
      totpSecret: secret,
      otpauthUri: c.otpauthUri(secret, admin.email),
    },
  };
};

// ── Login, step 2: TOTP code → session ──────────────────────────────────────
const verifySecondFactor = async ({ challenge, code, ip, userAgent }) => {
  const payload = readChallenge(challenge);
  const admin = await repo.findById(payload.sub);
  if (!admin || !admin.is_active) throw LOGIN_FAILED();
  if (isLocked(admin)) throw LOCKED();

  let step;
  if (payload.setup) {
    if (!admin.totp_pending_enc) throw new AppError('Étape de connexion expirée, recommence', 401, 'ADMIN_CHALLENGE_INVALID');
    const secret = c.decryptSecret(admin.totp_pending_enc);
    step = c.verifyTotp(secret, code);
    if (step != null) await repo.confirmTotp(admin.id, { secretEnc: admin.totp_pending_enc, step });
  } else {
    if (!admin.totp_secret_enc) throw new AppError('Étape de connexion expirée, recommence', 401, 'ADMIN_CHALLENGE_INVALID');
    const secret = c.decryptSecret(admin.totp_secret_enc);
    step = c.verifyTotp(secret, code, { lastStep: admin.totp_last_step });
    if (step != null) await repo.recordTotpLogin(admin.id, step);
  }

  if (step == null) {
    await repo.recordFailedLogin(admin.id, { maxAttempts: MAX_FAILED_ATTEMPTS, lockMinutes: LOCK_MINUTES });
    throw new AppError('Code incorrect', 401, 'ADMIN_TOTP_FAILED');
  }

  const token = c.generateSessionToken();
  await repo.createSession({
    id: randomUUID(),
    adminId: admin.id,
    tokenHash: c.hashToken(token),
    ip: ip || null,
    userAgent: userAgent ? String(userAgent).slice(0, 300) : null,
    ttlMs: SESSION_ABSOLUTE_MS,
  });

  const fresh = await repo.findPublicById(admin.id);
  return { token, admin: toPublic(fresh), enrolled: !!payload.setup };
};

// ── Session lookup (used by the auth middleware) ────────────────────────────
const resolveSession = async (token) => {
  if (!token) return null;
  const session = await repo.findActiveSession(c.hashToken(token));
  if (!session || !session.is_active) return null;

  const idleMs = Number(session.idle_seconds) * 1000;
  if (idleMs > SESSION_IDLE_MS) {
    await repo.revokeSession(session.session_id);
    return null;
  }
  // Refresh at most once a minute.
  if (idleMs > 60_000) await repo.touchSession(session.session_id);
  return session;
};

const logout = async (sessionId) => repo.revokeSession(sessionId);

const changeOwnPassword = async (admin, { currentPassword, newPassword }, sessionId) => {
  const full = await repo.findById(admin.id);
  if (!full || !(await c.verifyPassword(currentPassword, full.password_hash))) {
    throw new AppError('Mot de passe actuel incorrect', 400, 'ADMIN_WRONG_PASSWORD');
  }
  validatePassword(newPassword);
  if (newPassword === currentPassword) {
    throw new AppError('Choisis un mot de passe différent de l’actuel', 400, 'ADMIN_SAME_PASSWORD');
  }
  await repo.setPassword(admin.id, { passwordHash: await c.hashPassword(newPassword), mustChange: false });
  await repo.revokeAllSessions(admin.id, { exceptSessionId: sessionId });
};

// ── Team management (owner only) ────────────────────────────────────────────
const listAdmins = async () => (await repo.listAdmins()).map(toPublic);

const createAdmin = async ({ email, displayName, role }) => {
  const normalized = normalizeEmail(email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) || normalized.length > 254) {
    throw new AppError('Email invalide', 400);
  }
  const name = String(displayName || '').trim();
  if (!name || name.length > 100) throw new AppError('Nom invalide', 400);
  if (!ROLES.includes(role)) throw new AppError('Rôle invalide', 400);
  if (await repo.findByEmail(normalized)) throw new AppError('Un admin utilise déjà cet email', 409, 'ADMIN_EXISTS');

  const temporaryPassword = c.generateTemporaryPassword();
  const created = await repo.createAdmin({
    id: randomUUID(),
    email: normalized,
    displayName: name,
    role,
    passwordHash: await c.hashPassword(temporaryPassword),
  });
  return { admin: toPublic(created), temporaryPassword };
};

const updateAdmin = async (actor, targetId, { role, isActive }) => {
  const target = await repo.findById(targetId);
  if (!target) throw new AppError('Admin introuvable', 404);
  if (role !== undefined && !ROLES.includes(role)) throw new AppError('Rôle invalide', 400);
  if (isActive !== undefined && typeof isActive !== 'boolean') throw new AppError('Valeur invalide', 400);

  if (target.id === actor.id && ((role && role !== target.role) || isActive === false)) {
    throw new AppError('Tu ne peux pas changer ton propre rôle ni te désactiver', 400, 'ADMIN_SELF_CHANGE');
  }
  const losesOwner = target.role === 'owner' && target.is_active
    && ((role && role !== 'owner') || isActive === false);
  if (losesOwner && (await repo.countActiveOwners()) <= 1) {
    throw new AppError('Il doit rester au moins un propriétaire actif', 400, 'ADMIN_LAST_OWNER');
  }

  const updated = await repo.updateAdmin(targetId, { role, isActive });
  if (isActive === false || (role && role !== target.role)) await repo.revokeAllSessions(targetId);
  return { before: toPublic(target), after: toPublic(updated) };
};

const resetAdminAccess = async (actor, targetId) => {
  const target = await repo.findById(targetId);
  if (!target) throw new AppError('Admin introuvable', 404);
  if (target.id === actor.id) {
    throw new AppError('Utilise « Changer mon mot de passe » pour ton propre compte', 400, 'ADMIN_SELF_CHANGE');
  }
  const temporaryPassword = c.generateTemporaryPassword();
  await repo.setPassword(targetId, { passwordHash: await c.hashPassword(temporaryPassword), mustChange: true });
  await repo.resetTwoFactor(targetId);
  await repo.revokeAllSessions(targetId);
  return { admin: toPublic(await repo.findPublicById(targetId)), temporaryPassword };
};

/** Used by the bootstrap script: create the first owner when there is none. */
const bootstrapOwner = async ({ email, displayName }) => {
  if ((await repo.countActiveOwners()) > 0) {
    throw new AppError('Un propriétaire existe déjà : crée les autres comptes depuis le back-office', 409, 'ADMIN_OWNER_EXISTS');
  }
  return createAdmin({ email, displayName, role: 'owner' });
};

module.exports = {
  ROLES,
  SESSION_ABSOLUTE_MS,
  SESSION_IDLE_MS,
  toPublic,
  login,
  verifySecondFactor,
  resolveSession,
  logout,
  changeOwnPassword,
  listAdmins,
  createAdmin,
  updateAdmin,
  resetAdminAccess,
  bootstrapOwner,
};
