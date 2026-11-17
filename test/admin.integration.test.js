// Integration tests for the back-office (need the test database, run in CI).
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const app = require('../src/app');
const pool = require('../src/config/database');
const adminService = require('../src/modules/admin/admin.service');
const c = require('../src/modules/admin/admin.crypto');

let seq = 0;
const uniqueEmail = (role) => `${role}.${Date.now()}.${seq++}@admin.test`;
const NEW_PASSWORD = 'un-mot-de-passe-solide-2026';

const ADMIN_HEADER = { 'X-Admin-Request': '1' };
const post = (agent, path, body) => agent.post(path).set(ADMIN_HEADER).send(body || {});

/** Code for the next unused TOTP step of this admin. */
const nextCode = async (adminId, secret) => {
  const { rows } = await pool.query('SELECT totp_last_step FROM admin_users WHERE id = $1', [adminId]);
  const last = rows[0]?.totp_last_step == null ? null : Number(rows[0].totp_last_step);
  const now = c.totpStep();
  const step = last != null && last >= now ? last + 1 : now;
  return c.hotp(c.base32Decode(secret), step);
};

/** Creates an admin and logs in fully (2FA enrolment + password change). */
const loginAs = async (role) => {
  const email = uniqueEmail(role);
  const { admin, temporaryPassword } = await adminService.createAdmin({ email, displayName: `Test ${role}`, role });
  const agent = request.agent(app);

  const step1 = await post(agent, '/admin/auth/login', { email, password: temporaryPassword }).expect(200);
  assert.equal(step1.body.step, 'totp_setup');
  const secret = step1.body.totpSecret;
  await post(agent, '/admin/auth/2fa', { challenge: step1.body.challenge, code: await nextCode(admin.id, secret) }).expect(200);
  await post(agent, '/admin/me/password', { currentPassword: temporaryPassword, newPassword: NEW_PASSWORD }).expect(200);

  return { agent, admin, email, secret };
};

// ── App-side helpers (anonymous identities, links, reports) ─────────────────
let ip = 0;
const initUser = async () => {
  const res = await request(app).post('/identity/init').set('x-forwarded-for', `198.20.0.${(ip++ % 200) + 20}`).expect(201);
  return { token: res.body.token, user: res.body.user };
};
const bearer = (u) => ({ Authorization: `Bearer ${u.token}` });

const reportedConversation = async () => {
  const owner = await initUser();
  const anon = await initUser();
  const link = (await request(app).post('/link').set(bearer(owner))).body;
  const { conversationId, anonymousPseudo } = (await request(app)
    .post('/conversation/resolve-link').set(bearer(anon)).send({ inviteCode: link.code }).expect(200)).body;
  await request(app).post('/message').set(bearer(anon)).send({ conversationId, content: 'avant' }).expect(201);
  const bad = (await request(app).post('/message').set(bearer(anon)).send({ conversationId, content: 'message abusif' }).expect(201)).body;
  await request(app).post('/message').set(bearer(owner)).send({ conversationId, content: 'après' }).expect(201);
  await request(app).post('/moderation/report').set(bearer(owner))
    .send({ conversationId, messageId: bad.id, reason: 'harcèlement' }).expect(201);
  const { rows } = await pool.query('SELECT id FROM reports WHERE message_id = $1', [bad.id]);
  return { owner, anon, conversationId, anonymousPseudo, badMessageId: bad.id, reportId: rows[0].id };
};

// ── Authentication ──────────────────────────────────────────────────────────
test('full login: 2FA enrolment, forced password change, then access', async () => {
  const email = uniqueEmail('owner');
  const { admin, temporaryPassword } = await adminService.createAdmin({ email, displayName: 'Boss', role: 'owner' });
  const agent = request.agent(app);

  const step1 = await post(agent, '/admin/auth/login', { email, password: temporaryPassword }).expect(200);
  assert.equal(step1.body.step, 'totp_setup');
  assert.match(step1.body.otpauthUri, /^otpauth:\/\/totp\//);

  await post(agent, '/admin/auth/2fa', { challenge: step1.body.challenge, code: '000000' }).expect(401);
  const step2 = await post(agent, '/admin/auth/2fa', {
    challenge: step1.body.challenge,
    code: await nextCode(admin.id, step1.body.totpSecret),
  }).expect(200);
  assert.equal(step2.body.admin.mustChangePassword, true);
  const cookie = step2.headers['set-cookie'].join(';');
  assert.match(cookie, /mystme_admin=/);
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Strict/i);

  // Temporary password: everything but the password change is refused.
  const blocked = await agent.get('/admin/stats').expect(403);
  assert.equal(blocked.body.code, 'ADMIN_PASSWORD_CHANGE_REQUIRED');
  await post(agent, '/admin/me/password', { currentPassword: temporaryPassword, newPassword: 'court' }).expect(400);
  await post(agent, '/admin/me/password', { currentPassword: temporaryPassword, newPassword: NEW_PASSWORD }).expect(200);

  const stats = await agent.get('/admin/stats').expect(200);
  assert.equal(typeof stats.body.totals.appUsers, 'number');
  for (const key of ['engagedAppUsers', 'engagedWebUsers', 'usersWithLink']) {
    assert.equal(typeof stats.body.totals[key], 'number', key);
  }
  assert.ok(Array.isArray(stats.body.daily));

  // Second login: TOTP is now required, and the secret is not shown again.
  const again = await post(request.agent(app), '/admin/auth/login', { email, password: NEW_PASSWORD }).expect(200);
  assert.equal(again.body.step, 'totp');
  assert.equal(again.body.totpSecret, undefined);
});

test('engaged users: only accounts that sent a message, never more than all accounts', async () => {
  const { agent } = await loginAs('support');
  await initUser(); // opens the app, never writes
  await reportedConversation(); // both participants write

  const t = (await agent.get('/admin/stats').expect(200)).body.totals;
  // Other test files run in parallel on the same database, so only check
  // invariants that hold whatever they do.
  assert.ok(t.engagedAppUsers >= 2, 'the two writers count');
  assert.ok(t.engagedAppUsers <= t.appUsers);
  assert.ok(t.engagedWebUsers <= t.webUsers);
  assert.ok(t.usersWithLink >= 1);

  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM users u
      WHERE u.origin = 'app' AND u.merged_into_user_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.sender_id = u.id)`,
  );
  assert.ok(rows[0].n >= 1, 'the idle account exists but is not engaged');
});

test('state-changing admin requests need the X-Admin-Request header', async () => {
  const res = await request(app).post('/admin/auth/login').send({ email: 'x@y.z', password: 'whatever' }).expect(403);
  assert.equal(res.body.code, 'ADMIN_CSRF');
});

test('unknown email and wrong password give the same answer', async () => {
  const unknown = await post(request(app), '/admin/auth/login', { email: 'nobody@admin.test', password: 'x' }).expect(401);
  const { email } = await loginAs('support');
  const wrong = await post(request(app), '/admin/auth/login', { email, password: 'mauvais' }).expect(401);
  assert.equal(unknown.body.message, wrong.body.message);
});

test('five wrong passwords lock the account, even for the right password', async () => {
  const { email } = await loginAs('support');
  for (let i = 0; i < 5; i += 1) {
    await post(request(app), '/admin/auth/login', { email, password: `mauvais-${i}` }).expect(401);
  }
  const locked = await post(request(app), '/admin/auth/login', { email, password: NEW_PASSWORD }).expect(423);
  assert.equal(locked.body.code, 'ADMIN_LOCKED');
});

test('logout revokes the session', async () => {
  const { agent } = await loginAs('support');
  await agent.get('/admin/me').expect(200);
  await post(agent, '/admin/auth/logout').expect(200);
  await agent.get('/admin/me').expect(401);
});

test('no session, no access', async () => {
  await request(app).get('/admin/stats').expect(401);
  await request(app).get('/admin/stats').set('Cookie', 'mystme_admin=forged').expect(401);
});

// ── Roles ───────────────────────────────────────────────────────────────────
test('roles: support sees the dashboard only, moderator cannot manage the team', async () => {
  const support = await loginAs('support');
  await support.agent.get('/admin/stats').expect(200);
  await support.agent.get('/admin/reports').expect(403);
  await support.agent.get('/admin/bans').expect(403);
  await support.agent.get('/admin/admins').expect(403);
  await support.agent.get('/admin/audit').expect(403);

  const moderator = await loginAs('moderator');
  await moderator.agent.get('/admin/reports').expect(200);
  await moderator.agent.get('/admin/admins').expect(403);
  await post(moderator.agent, '/admin/admins', { email: uniqueEmail('x'), displayName: 'X', role: 'owner' }).expect(403);
});

// ── Moderation ──────────────────────────────────────────────────────────────
test('moderators judge content without learning who anyone is', async () => {
  const s = await reportedConversation();
  const { agent } = await loginAs('moderator');

  const list = await agent.get('/admin/reports?status=pending').expect(200);
  const item = list.body.items.find((r) => r.id === s.reportId);
  assert.ok(item);
  assert.equal(item.reportedRole, 'anonymous');
  assert.equal(item.reporterRole, 'owner');
  assert.equal(item.message.content, 'message abusif');
  assert.equal(item.conversation.alias, s.anonymousPseudo);
  assert.match(item.target.ref, /^[0-9a-f]{10}$/);

  const detail = await agent.get(`/admin/reports/${s.reportId}`).expect(200);
  assert.deepEqual(detail.body.report.context.map((m) => [m.role, m.content, m.isReported]), [
    ['anonymous', 'avant', false],
    ['anonymous', 'message abusif', true],
    ['owner', 'après', false],
  ]);

  const everything = JSON.stringify([list.body, detail.body]);
  for (const secret of [s.anon.user.id, s.owner.user.id, s.anon.user.pseudo, s.owner.user.pseudo]) {
    assert.ok(!everything.includes(secret), `leaked ${secret}`);
  }
});

test('review with ban: message hidden, account banned and logged out, then ban lifted', async () => {
  const s = await reportedConversation();
  const { agent } = await loginAs('moderator');

  await post(agent, `/admin/reports/${s.reportId}/review`, { decision: 'reviewed', banUser: true }).expect(400);
  const reviewed = await post(agent, `/admin/reports/${s.reportId}/review`, {
    decision: 'reviewed',
    hideMessage: true,
    banUser: true,
    banReason: 'Harcèlement répété',
  }).expect(200);
  assert.equal(reviewed.body.report.status, 'reviewed');
  assert.equal(reviewed.body.report.message.isDeleted, true);
  assert.equal(reviewed.body.report.target.isBanned, true);
  assert.equal(reviewed.body.report.reviewedBy, 'Test moderator');

  // Already handled.
  await post(agent, `/admin/reports/${s.reportId}/review`, { decision: 'dismissed' }).expect(409);

  // The banned account's existing token no longer works.
  const after = await request(app).get('/conversation/mine').set(bearer(s.anon));
  assert.ok([401, 403].includes(after.status), `status ${after.status}`);

  const bans = await agent.get('/admin/bans').expect(200);
  const ban = bans.body.items.find((b) => b.ref === reviewed.body.report.target.ref);
  assert.ok(ban);
  assert.equal(ban.reason, 'Harcèlement répété');
  assert.equal(ban.bannedBy, 'Test moderator');
  assert.ok(!JSON.stringify(bans.body).includes(s.anon.user.id));

  await post(agent, `/admin/bans/${ban.ref}/lift`, {}).expect(400);
  await post(agent, `/admin/bans/${ban.ref}/lift`, { reason: 'Erreur de jugement' }).expect(200);
  const { rows } = await pool.query('SELECT is_banned FROM users WHERE id = $1', [s.anon.user.id]);
  assert.equal(rows[0].is_banned, false);
});

// ── Team & audit ────────────────────────────────────────────────────────────
test('owner manages the team; the last owner cannot be demoted', async () => {
  const owner = await loginAs('owner');

  const created = await post(owner.agent, '/admin/admins', {
    email: uniqueEmail('new'), displayName: 'Nouvelle modo', role: 'moderator',
  }).expect(201);
  assert.match(created.body.temporaryPassword, /^[A-Za-z2-9]{4}(-[A-Za-z2-9]{4}){3}$/);
  await post(owner.agent, '/admin/admins', { email: created.body.admin.email, displayName: 'Doublon', role: 'support' }).expect(409);

  await owner.agent.patch(`/admin/admins/${owner.admin.id}`).set(ADMIN_HEADER).send({ isActive: false }).expect(400);
  await owner.agent.patch(`/admin/admins/${owner.admin.id}`).set(ADMIN_HEADER).send({ role: 'support' }).expect(400);

  const updated = await owner.agent.patch(`/admin/admins/${created.body.admin.id}`)
    .set(ADMIN_HEADER).send({ role: 'support' }).expect(200);
  assert.equal(updated.body.admin.role, 'support');

  const reset = await post(owner.agent, `/admin/admins/${created.body.admin.id}/reset`).expect(200);
  assert.equal(reset.body.admin.totpEnabled, false);
  assert.equal(reset.body.admin.mustChangePassword, true);
});

test('deactivating an admin ends their sessions', async () => {
  const owner = await loginAs('owner');
  const mod = await loginAs('moderator');
  await mod.agent.get('/admin/reports').expect(200);
  await owner.agent.patch(`/admin/admins/${mod.admin.id}`).set(ADMIN_HEADER).send({ isActive: false }).expect(200);
  await mod.agent.get('/admin/reports').expect(401);
});

test('every sensitive action lands in an append-only audit log', async () => {
  const owner = await loginAs('owner');
  const s = await reportedConversation();
  await owner.agent.get(`/admin/reports/${s.reportId}`).expect(200);
  await post(owner.agent, `/admin/reports/${s.reportId}/review`, { decision: 'dismissed', note: 'rien à signaler' }).expect(200);

  const audit = await owner.agent.get(`/admin/audit?limit=50&adminId=${owner.admin.id}`).expect(200);
  assert.ok(audit.body.items.every((e) => e.admin_id === owner.admin.id));
  const ids = audit.body.items.map((e) => Number(e.id));
  assert.deepEqual(ids, [...ids].sort((x, y) => y - x), 'newest first, numerically');
  const mine = audit.body.items.filter((e) => e.admin_id === owner.admin.id).map((e) => e.action);
  for (const action of ['auth.2fa_enrolled', 'auth.password_changed', 'report.viewed', 'report.dismissed']) {
    assert.ok(mine.includes(action), `missing ${action}`);
  }

  await assert.rejects(pool.query('UPDATE admin_audit_log SET action = $1', ['tampered']), /append-only/);
  await assert.rejects(pool.query('DELETE FROM admin_audit_log'), /append-only/);
});

test('first owner bootstrap refuses when an owner already exists', async () => {
  await loginAs('owner');
  await assert.rejects(adminService.bootstrapOwner({ email: uniqueEmail('boot'), displayName: 'Boot' }), /propriétaire existe déjà/);
});

test.after(async () => {
  await pool.end();
});
