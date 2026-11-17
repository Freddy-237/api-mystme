/**
 * Back-office API, mounted on /admin.
 *
 * Roles:
 *   owner     — everything, including the team and the audit log
 *   moderator — dashboard, reports, bans
 *   support   — dashboard (read only) for now; account lookup comes in phase 2
 */
const express = require('express');
const createRateLimit = require('../../middlewares/rateLimit.middleware');
const AppError = require('../../utils/AppError');
const adminService = require('./admin.service');
const moderation = require('./admin.moderation');
const stats = require('./admin.stats');
const repo = require('./admin.repository');
const {
  setSessionCookie,
  clearSessionCookie,
  requireAdminHeader,
  requireAdmin,
  requirePasswordChanged,
  requireRole,
  audit,
} = require('./admin.auth');

const router = express.Router();
const isTest = process.env.NODE_ENV === 'test';
const passThrough = (_req, _res, next) => next();
const limiter = (scope, opts) => (isTest ? passThrough : createRateLimit(scope, opts));

const loginIpLimiter = limiter('admin:login:ip', {
  windowMs: 15 * 60_000,
  maxRequests: 20,
  message: 'Trop de tentatives de connexion, réessaie dans 15 minutes',
});
const loginEmailLimiter = limiter('admin:login:email', {
  windowMs: 15 * 60_000,
  maxRequests: 10,
  keyGenerator: (req) => String(req.body?.email || '').trim().toLowerCase() || req.ip,
  message: 'Trop de tentatives de connexion, réessaie dans 15 minutes',
});
const apiLimiter = limiter('admin:api', { windowMs: 60_000, maxRequests: 120 });

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Admin responses are never cached, and the admin site is never indexed.
router.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  next();
});
router.use(requireAdminHeader);

// ── Authentication ──────────────────────────────────────────────────────────
router.post('/auth/login', loginIpLimiter, loginEmailLimiter, wrap(async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) throw new AppError('Email et mot de passe requis', 400);
  try {
    const { admin, result } = await adminService.login({ email, password });
    await audit(req, 'auth.password_ok', { admin, details: { next: result.step } });
    res.json(result);
  } catch (error) {
    if (error.statusCode === 401 || error.statusCode === 423) {
      const known = await repo.findByEmail(String(email).trim().toLowerCase());
      await audit(req, error.statusCode === 423 ? 'auth.locked' : 'auth.login_failed', {
        admin: known ? { id: known.id, email: known.email } : { id: null, email: null },
        details: known ? {} : { unknownEmail: true },
      });
    }
    throw error;
  }
}));

router.post('/auth/2fa', loginIpLimiter, wrap(async (req, res) => {
  const { challenge, code } = req.body || {};
  const { token, admin, enrolled } = await adminService.verifySecondFactor({
    challenge,
    code,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  });
  setSessionCookie(res, token);
  await audit(req, enrolled ? 'auth.2fa_enrolled' : 'auth.login', { admin });
  res.json({ admin });
}));

router.post('/auth/logout', requireAdmin, wrap(async (req, res) => {
  await adminService.logout(req.admin.sessionId);
  clearSessionCookie(res);
  await audit(req, 'auth.logout');
  res.json({ ok: true });
}));

router.get('/me', requireAdmin, wrap(async (req, res) => {
  const admin = await repo.findPublicById(req.admin.id);
  res.json({ admin: adminService.toPublic(admin) });
}));

router.post('/me/password', requireAdmin, wrap(async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  await adminService.changeOwnPassword(req.admin, { currentPassword, newPassword }, req.admin.sessionId);
  await audit(req, 'auth.password_changed');
  const admin = await repo.findPublicById(req.admin.id);
  res.json({ admin: adminService.toPublic(admin) });
}));

// Everything below needs a logged-in admin who replaced the temporary password.
router.use(requireAdmin, requirePasswordChanged, apiLimiter);

// ── Dashboard ───────────────────────────────────────────────────────────────
router.get('/stats', wrap(async (req, res) => {
  res.json(await stats.getDashboard({ days: req.query.days }));
}));

// ── Moderation ──────────────────────────────────────────────────────────────
const canModerate = requireRole('owner', 'moderator');

router.get('/reports', canModerate, wrap(async (req, res) => {
  res.json({ items: await moderation.listReports({ status: req.query.status || 'pending', limit: req.query.limit }) });
}));

router.get('/reports/:id', canModerate, wrap(async (req, res) => {
  const report = await moderation.getReport(req.params.id);
  // Reading reported content is itself an action worth tracing.
  await audit(req, 'report.viewed', { targetType: 'report', targetId: report.id });
  res.json({ report });
}));

router.post('/reports/:id/review', canModerate, wrap(async (req, res) => {
  const body = req.body || {};
  const { report, targetRef } = await moderation.reviewReport(req.admin, req.params.id, body);
  await audit(req, `report.${body.decision === 'dismissed' ? 'dismissed' : 'reviewed'}`, {
    targetType: 'report',
    targetId: report.id,
    details: {
      hideMessage: !!body.hideMessage,
      blockConversation: !!body.blockConversation,
      banUser: !!body.banUser,
      note: report.decisionNote,
    },
  });
  if (body.decision === 'reviewed' && body.banUser) {
    await audit(req, 'user.banned', {
      targetType: 'user',
      targetId: targetRef,
      details: { reportId: report.id, reason: body.banReason || body.note || null },
    });
  }
  res.json({ report });
}));

router.get('/bans', canModerate, wrap(async (req, res) => {
  res.json({ items: await moderation.listBans({ limit: req.query.limit }) });
}));

router.post('/bans/:ref/lift', canModerate, wrap(async (req, res) => {
  const result = await moderation.unban(req.params.ref, req.body?.reason);
  await audit(req, 'user.unbanned', { targetType: 'user', targetId: result.ref, details: { reason: result.reason } });
  res.json({ ok: true });
}));

// ── Team (owner only) ───────────────────────────────────────────────────────
const ownerOnly = requireRole('owner');

router.get('/admins', ownerOnly, wrap(async (_req, res) => {
  res.json({ items: await adminService.listAdmins() });
}));

router.post('/admins', ownerOnly, wrap(async (req, res) => {
  const { email, displayName, role } = req.body || {};
  const { admin, temporaryPassword } = await adminService.createAdmin({ email, displayName, role });
  await audit(req, 'admin.created', { targetType: 'admin', targetId: admin.id, details: { email: admin.email, role: admin.role } });
  res.status(201).json({ admin, temporaryPassword });
}));

router.patch('/admins/:id', ownerOnly, wrap(async (req, res) => {
  const { role, isActive } = req.body || {};
  const { before, after } = await adminService.updateAdmin(req.admin, req.params.id, { role, isActive });
  await audit(req, 'admin.updated', {
    targetType: 'admin',
    targetId: after.id,
    details: {
      email: after.email,
      role: before.role !== after.role ? { from: before.role, to: after.role } : undefined,
      isActive: before.isActive !== after.isActive ? { from: before.isActive, to: after.isActive } : undefined,
    },
  });
  res.json({ admin: after });
}));

router.post('/admins/:id/reset', ownerOnly, wrap(async (req, res) => {
  const { admin, temporaryPassword } = await adminService.resetAdminAccess(req.admin, req.params.id);
  await audit(req, 'admin.access_reset', { targetType: 'admin', targetId: admin.id, details: { email: admin.email } });
  res.json({ admin, temporaryPassword });
}));

// ── Audit log (owner only) ──────────────────────────────────────────────────
router.get('/audit', ownerOnly, wrap(async (req, res) => {
  const items = await repo.listAudit({
    limit: req.query.limit,
    beforeId: req.query.before && /^\d+$/.test(req.query.before) ? req.query.before : null,
    adminId: req.query.adminId && /^[0-9a-f-]{36}$/i.test(req.query.adminId) ? req.query.adminId : null,
  });
  res.json({ items, nextBefore: items.length ? items[items.length - 1].id : null });
}));

module.exports = router;
