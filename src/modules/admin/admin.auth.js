/**
 * Back-office authentication.
 *
 * The session token lives in an httpOnly cookie scoped to /admin, so page
 * scripts can never read it. Every state-changing request must also carry the
 * `X-Admin-Request: 1` header: a cross-site form cannot set a custom header,
 * and a cross-site script cannot pass the CORS preflight. Together with
 * SameSite=Strict this closes CSRF.
 */
const env = require('../../config/env');
const parseCookies = require('../../utils/parseCookies');
const AppError = require('../../utils/AppError');
const adminService = require('./admin.service');
const logger = require('../../utils/logger');
const repo = require('./admin.repository');

const ADMIN_COOKIE = 'mystme_admin';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const cookieOptions = () => ({
  httpOnly: true,
  secure: env.isProduction,
  sameSite: 'strict',
  path: '/admin',
  maxAge: adminService.SESSION_ABSOLUTE_MS,
});

const setSessionCookie = (res, token) => res.cookie(ADMIN_COOKIE, token, cookieOptions());
const clearSessionCookie = (res) => res.clearCookie(ADMIN_COOKIE, { ...cookieOptions(), maxAge: undefined });

/** Blocks cross-site form posts on every admin route, logged in or not. */
const requireAdminHeader = (req, _res, next) => {
  if (SAFE_METHODS.has(req.method)) return next();
  if (req.headers['x-admin-request'] !== '1') {
    return next(new AppError('Requête refusée', 403, 'ADMIN_CSRF'));
  }
  return next();
};

const requireAdmin = async (req, _res, next) => {
  try {
    const token = parseCookies(req.headers.cookie)[ADMIN_COOKIE];
    const session = await adminService.resolveSession(token);
    if (!session) return next(new AppError('Session admin expirée, reconnecte-toi', 401, 'ADMIN_AUTH_REQUIRED'));
    req.admin = {
      id: session.id,
      email: session.email,
      displayName: session.display_name,
      role: session.role,
      mustChangePassword: !!session.must_change_password,
      sessionId: session.session_id,
    };
    return next();
  } catch (error) {
    return next(error);
  }
};

/** Until the temporary password is replaced, only a few routes are usable. */
const requirePasswordChanged = (req, _res, next) => {
  if (req.admin?.mustChangePassword) {
    return next(new AppError('Change ton mot de passe temporaire pour continuer', 403, 'ADMIN_PASSWORD_CHANGE_REQUIRED'));
  }
  return next();
};

const requireRole = (...roles) => (req, _res, next) => {
  if (!req.admin || !roles.includes(req.admin.role)) {
    return next(new AppError('Accès réservé', 403, 'ADMIN_FORBIDDEN'));
  }
  return next();
};

/** Append one line to the audit log. Never throws into the request. */
const audit = async (req, action, { targetType = null, targetId = null, details = {}, admin = req.admin } = {}) => {
  try {
    await repo.insertAudit({
      adminId: admin?.id || null,
      adminEmail: admin?.email || null,
      action,
      targetType,
      targetId: targetId != null ? String(targetId) : null,
      details,
      ip: req.ip || null,
    });
  } catch (error) {
    // Audit must not silently disappear: surface it in logs.
    logger.error({ action, err: error.message }, 'admin audit write failed');
  }
};

module.exports = {
  ADMIN_COOKIE,
  setSessionCookie,
  clearSessionCookie,
  requireAdminHeader,
  requireAdmin,
  requirePasswordChanged,
  requireRole,
  audit,
};
