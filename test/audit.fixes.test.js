// Regression tests for the November 2026 audit fixes.
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const app = require('../src/app');
const env = require('../src/config/env');
const pool = require('../src/config/database');
const withTransaction = require('../src/utils/withTransaction');
const backup = require('../src/services/backup.service');
const maintenance = require('../src/jobs/maintenance.job');
const { loginAsAdmin } = require('./helpers/adminSession');

let ipCounter = 0;

async function initIdentity() {
  ipCounter += 1;
  const res = await request(app)
    .post('/identity/init')
    .set('x-forwarded-for', `10.9.0.${ipCounter}`)
    .expect(201);
  const setCookie = res.headers['set-cookie'] || [];
  const authCookie = (setCookie.find((h) => h.startsWith(`${env.authCookieName}=`)) || '').split(';')[0];
  const csrfCookie = (setCookie.find((h) => h.startsWith(`${env.csrfCookieName}=`)) || '').split(';')[0];
  return { token: res.body.token, user: res.body.user, authCookie, csrfToken: csrfCookie.split('=')[1] };
}

const authed = (req, a) => req
  .set('Authorization', `Bearer ${a.token}`)
  .set('Cookie', a.authCookie)
  .set(env.csrfHeaderName || 'x-csrf-token', a.csrfToken);

async function conversationBetween(owner, anon) {
  const link = await request(app).post('/link').set('Authorization', `Bearer ${owner.token}`).expect(201);
  const res = await authed(
    request(app).post('/conversation/resolve-link').send({ inviteCode: link.body.code }), anon,
  ).expect(200);
  return { conversationId: res.body.conversationId, code: link.body.code };
}

const send = (a, conversationId, content) => authed(
  request(app).post('/message').send({ conversationId, content }), a,
).expect(201);

test('a report keeps its evidence after the reported account deletes itself', async () => {
  const owner = await initIdentity();
  const anon = await initIdentity();
  const { conversationId } = await conversationBetween(owner, anon);
  await send(anon, conversationId, 'avant');
  const bad = await send(anon, conversationId, 'message abusif');
  await send(owner, conversationId, 'après');

  const report = await authed(request(app).post('/moderation/report')
    .send({ conversationId, messageId: bad.body.id, reason: 'harcèlement' }), owner).expect(201);

  // The reported author erases their account (and the conversation with it).
  await authed(request(app).delete('/identity/me'), anon).expect(200);

  const moderator = await loginAsAdmin(app, 'moderator', 'Ops Evidence');
  const pending = await moderator.agent.get('/admin/reports?status=pending').expect(200);
  assert.ok(pending.body.items.some((r) => r.id === report.body.id), 'report still listed');

  const detail = { body: (await moderator.agent.get(`/admin/reports/${report.body.id}`).expect(200)).body.report };
  assert.equal(detail.body.message.content, 'message abusif');
  assert.equal(detail.body.reportedRole, 'anonymous');
  assert.equal(detail.body.target.isDeleted, true);
  assert.equal(detail.body.conversation.status, 'deleted');
  assert.deepEqual(detail.body.context.map((m) => m.content), ['avant', 'message abusif', 'après']);
  assert.deepEqual(detail.body.context.map((m) => m.role), ['anonymous', 'anonymous', 'owner']);

  // Banning a deleted account is refused with a clear message; dismissing works.
  const ban = await moderator.post(`/admin/reports/${report.body.id}/review`,
    { decision: 'reviewed', banUser: true, note: 'abus' });
  assert.equal(ban.status, 409);
  await moderator.post(`/admin/reports/${report.body.id}/review`,
    { decision: 'reviewed', note: 'compte déjà supprimé' }).expect(200);
});

test('two reported messages from the same author no longer block its account deletion', async () => {
  const owner = await initIdentity();
  const anon = await initIdentity();
  const { conversationId } = await conversationBetween(owner, anon);
  const m1 = await send(anon, conversationId, 'un');
  const m2 = await send(anon, conversationId, 'deux');
  for (const m of [m1, m2]) {
    await authed(request(app).post('/moderation/report')
      .send({ conversationId, messageId: m.body.id }), owner).expect(201);
  }
  // Direct deletion of the user row (not via the account-deletion service).
  await pool.query('DELETE FROM users WHERE id = $1', [anon.user.id]);
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM reports WHERE reported_user_id = $1', [anon.user.id]);
  assert.equal(rows[0].n, 2);
});

test('a banned account\'s invite link stops working', async () => {
  const owner = await initIdentity();
  const anon = await initIdentity();
  const { conversationId, code } = await conversationBetween(owner, anon);
  await send(owner, conversationId, 'salut');
  const report = await authed(request(app).post('/moderation/report')
    .send({ conversationId }), anon).expect(201);

  const moderator = await loginAsAdmin(app, 'moderator', 'Ops Link');
  await moderator.post(`/admin/reports/${report.body.id}/review`,
    { decision: 'reviewed', banUser: true, note: 'spam' }).expect(200);

  await request(app).get(`/link/code/${code}`).expect(404);
  const visitor = await initIdentity();
  await authed(request(app).post('/conversation/resolve-link').send({ inviteCode: code }), visitor).expect(404);
});

test('a conversation the owner deleted stays deleted when the visitor reopens the link, and comes back on a new message', async () => {
  const owner = await initIdentity();
  const anon = await initIdentity();
  const { conversationId, code } = await conversationBetween(owner, anon);
  await send(anon, conversationId, 'coucou');
  await authed(request(app).delete(`/conversation/${conversationId}`), owner).expect(200);

  const listed = async () => (await authed(request(app).get('/conversation/mine'), owner).expect(200))
    .body.items.some((c) => c.id === conversationId);

  await authed(request(app).post('/conversation/resolve-link').send({ inviteCode: code }), anon).expect(200);
  assert.equal(await listed(), false, 'reopening the link must not resurrect it');

  await send(anon, conversationId, 'je reviens');
  assert.equal(await listed(), true, 'a new message brings it back');
});

test('deleting a message with media clears its file unless it is under a pending report', async () => {
  const owner = await initIdentity();
  const anon = await initIdentity();
  const { conversationId } = await conversationBetween(owner, anon);
  const insert = async (url) => (await pool.query(
    `INSERT INTO messages (id, conversation_id, sender_id, content, media_url, media_type)
     VALUES (gen_random_uuid(), $1, $2, '[image]', $3, 'image') RETURNING id`,
    [conversationId, anon.user.id, url],
  )).rows[0].id;
  const plain = await insert('https://example.invalid/not-ours.jpg');
  const reported = await insert('https://example.invalid/evidence.jpg');
  await authed(request(app).post('/moderation/report')
    .send({ conversationId, messageId: reported }), owner).expect(201);

  await authed(request(app).delete(`/message/${plain}`), anon).expect(200);
  await authed(request(app).delete(`/message/${reported}`), anon).expect(200);
  const { rows } = await pool.query('SELECT id, media_url FROM messages WHERE id = ANY($1::uuid[])', [[plain, reported]]);
  const byId = Object.fromEntries(rows.map((r) => [r.id, r.media_url]));
  assert.equal(byId[plain], null);
  assert.equal(byId[reported], 'https://example.invalid/evidence.jpg');

  // Once the report is handled, the daily maintenance removes it too.
  await pool.query("UPDATE reports SET status = 'dismissed', reviewed_at = NOW() WHERE message_id = $1", [reported]);
  await maintenance.cleanDeletedMessageMedia();
  const after = await pool.query('SELECT media_url FROM messages WHERE id = $1', [reported]);
  assert.equal(after.rows[0].media_url, null);
});

test('backups: encrypted round trip restores every row exactly', async () => {
  const key = require('crypto').randomBytes(32);
  const payload = await backup.exportDatabase();
  assert.equal(payload.format, backup.FORMAT);
  assert.ok(payload.tables.users && payload.tables.schema_migrations.length > 0);
  assert.equal(payload.tables.distributed_rate_limits, undefined);

  const file = await backup.encrypt(payload, key);
  assert.ok(!file.toString('latin1').includes('schema_migrations'), 'backup must not be readable');
  await assert.rejects(backup.decrypt(file, require('crypto').randomBytes(32)));
  const back = await backup.decrypt(file, key);
  assert.deepEqual(back.counts, payload.counts);

  // Restore into a throwaway database (migrated from scratch), so the
  // TRUNCATE of a restore never touches the database other tests use.
  const { Pool } = require('pg');
  const { spawnSync } = require('node:child_process');
  const dbName = `mystme_restore_${process.pid}`;
  await pool.query(`DROP DATABASE IF EXISTS ${dbName}`);
  await pool.query(`CREATE DATABASE ${dbName}`);
  const url = new URL(process.env.DATABASE_URL);
  url.pathname = `/${dbName}`;
  const migrated = spawnSync(process.execPath, ['src/database/runMigration.js'], {
    cwd: require('path').resolve(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: url.toString() },
    encoding: 'utf8',
  });
  assert.equal(migrated.status, 0, migrated.stderr);
  const other = new Pool({ connectionString: url.toString() });
  const client = await other.connect();
  try {
    await client.query('BEGIN');
    const restored = await backup.restoreDatabase(back, client);
    await client.query('COMMIT');
    assert.equal(restored.users, payload.counts.users);
    for (const table of ['users', 'messages', 'reports', 'admin_audit_log']) {
      const { rows } = await client.query(`SELECT COUNT(*)::int AS n FROM ${table}`);
      assert.equal(rows[0].n, payload.counts[table], table);
    }
    const sample = payload.tables.users[0];
    if (sample) {
      const { rows } = await client.query(
        'SELECT row_to_json(u)::text AS j FROM users u WHERE id = $1', [sample.id],
      );
      assert.deepEqual(JSON.parse(rows[0].j), sample);
    }
  } finally {
    client.release();
    await other.end();
    await pool.query(`DROP DATABASE IF EXISTS ${dbName}`);
  }
});

test('retention erases old handled reports of deleted conversations and expired codes', async () => {
  const owner = await initIdentity();
  await pool.query(
    `INSERT INTO reports (id, conversation_id, message_id, reported_by, reason, status, reviewed_at, kind)
     VALUES (gen_random_uuid(), NULL, NULL, $1, 'old', 'reviewed', NOW() - INTERVAL '200 days', 'conversation')`,
    [owner.user.id],
  );
  const before = await pool.query("SELECT COUNT(*)::int AS n FROM reports WHERE reason = 'old' AND reported_by = $1", [owner.user.id]);
  assert.equal(before.rows[0].n, 1);
  await maintenance.applyRetention();
  const after = await pool.query("SELECT COUNT(*)::int AS n FROM reports WHERE reason = 'old' AND reported_by = $1", [owner.user.id]);
  assert.equal(after.rows[0].n, 0);
});

test('withTransaction export works under a transaction client', async () => {
  const counts = await withTransaction(async (client) => (await backup.exportDatabase(client)).counts);
  assert.ok(counts.users >= 0);
});
