// Logs a fresh back-office account in (2FA enrolment + password change) and
// returns a supertest agent carrying its session cookie.
const assert = require('node:assert/strict');
const request = require('supertest');
const pool = require('../../src/config/database');
const adminService = require('../../src/modules/admin/admin.service');
const c = require('../../src/modules/admin/admin.crypto');

let seq = 0;
const ADMIN_HEADER = { 'X-Admin-Request': '1' };

const nextCode = async (adminId, secret) => {
  const { rows } = await pool.query('SELECT totp_last_step FROM admin_users WHERE id = $1', [adminId]);
  const last = rows[0]?.totp_last_step == null ? null : Number(rows[0].totp_last_step);
  const now = c.totpStep();
  return c.hotp(c.base32Decode(secret), last != null && last >= now ? last + 1 : now);
};

const loginAsAdmin = async (app, role = 'moderator', displayName = `Test ${role}`) => {
  const email = `${role}.${Date.now()}.${seq++}@helper.admin.test`;
  const { admin, temporaryPassword } = await adminService.createAdmin({ email, displayName, role });
  const agent = request.agent(app);
  const post = (path, body) => agent.post(path).set(ADMIN_HEADER).send(body || {});

  const step1 = await post('/admin/auth/login', { email, password: temporaryPassword }).expect(200);
  assert.equal(step1.body.step, 'totp_setup');
  await post('/admin/auth/2fa', { challenge: step1.body.challenge, code: await nextCode(admin.id, step1.body.totpSecret) }).expect(200);
  await post('/admin/me/password', { currentPassword: temporaryPassword, newPassword: 'mot-de-passe-de-test-2026' }).expect(200);

  return { agent, admin, post };
};

module.exports = { loginAsAdmin, ADMIN_HEADER };
