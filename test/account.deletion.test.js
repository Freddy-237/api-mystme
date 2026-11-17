// Account deletion. The first tests need no database; the integration ones
// need the test database (run in CI).
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const app = require('../src/app');
const pool = require('../src/config/database');
const { publicIdFromUrl } = require('../src/services/upload.service');

const BASE = 'https://res.cloudinary.com/demo';

test('publicIdFromUrl: images and videos drop the extension', () => {
  assert.deepEqual(
    publicIdFromUrl(`${BASE}/image/upload/v1712345678/mystme/messages/images/abc_1700000000000.jpg`, 'image'),
    { publicId: 'mystme/messages/images/abc_1700000000000', resourceType: 'image' },
  );
  assert.deepEqual(
    publicIdFromUrl(`${BASE}/video/upload/v1/mystme/messages/audio/abc_1.m4a`, 'audio'),
    { publicId: 'mystme/messages/audio/abc_1', resourceType: 'video' },
  );
});

test('publicIdFromUrl: raw files keep their full name', () => {
  assert.deepEqual(
    publicIdFromUrl(`${BASE}/raw/upload/v1/mystme/messages/files/abc_1`, 'file'),
    { publicId: 'mystme/messages/files/abc_1', resourceType: 'raw' },
  );
});

test('publicIdFromUrl: refuses anything outside our folder', () => {
  assert.equal(publicIdFromUrl(`${BASE}/image/upload/v1/other/folder/x.jpg`, 'image'), null);
  assert.equal(publicIdFromUrl('https://example.com/whatever.jpg', 'image'), null);
  assert.equal(publicIdFromUrl('not a url', 'image'), null);
  assert.equal(publicIdFromUrl(`${BASE}/image/upload/v1/mystme/messages/images/a.jpg`, 'unknown'), null);
});

// ── Integration ─────────────────────────────────────────────────────────────
let ip = 0;
const nextIp = () => `198.20.0.${(ip++ % 200) + 20}`;
const auth = (token) => ({ Authorization: `Bearer ${token}` });

const init = async () => {
  const res = await request(app).post('/identity/init').set('x-forwarded-for', nextIp()).send({}).expect(201);
  return { token: res.body.token, user: res.body.user };
};
const linkOf = async (owner) => (await request(app).post('/link').set(auth(owner.token))).body;
const writeVia = async (visitor, link, content) => {
  const resolved = await request(app).post('/conversation/resolve-link')
    .set(auth(visitor.token)).send({ inviteCode: link.code }).expect(200);
  await request(app).post('/message').set(auth(visitor.token))
    .send({ conversationId: resolved.body.conversationId, content }).expect(201);
  return resolved.body.conversationId;
};
const count = async (sql, params) => (await pool.query(sql, params)).rows[0].n;

test('deleting an account erases it and everything attached', async () => {
  const awa = await init();
  const bob = await init();
  const awaLink = await linkOf(awa);
  const bobLink = await linkOf(bob);

  const received = await writeVia(bob, awaLink, 'reçu par Awa');   // Awa is the owner
  const sent = await writeVia(awa, bobLink, 'envoyé par Awa');     // Awa is anonymous
  const chloe = await init();
  const untouched = await writeVia(chloe, bobLink, 'sans rapport');

  const res = await request(app).delete('/identity/me')
    .set('x-forwarded-for', nextIp()).set(auth(awa.token)).expect(200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.deletedConversations, 2);

  assert.equal(await count('SELECT COUNT(*)::int AS n FROM users WHERE id = $1', [awa.user.id]), 0);
  assert.equal(await count('SELECT COUNT(*)::int AS n FROM links WHERE owner_id = $1', [awa.user.id]), 0);
  assert.equal(
    await count('SELECT COUNT(*)::int AS n FROM conversations WHERE id = ANY($1::uuid[])', [[received, sent]]),
    0,
  );
  assert.equal(
    await count('SELECT COUNT(*)::int AS n FROM messages WHERE conversation_id = ANY($1::uuid[])', [[received, sent]]),
    0,
  );

  // Her token is dead, her link no longer resolves.
  await request(app).get('/identity/me').set(auth(awa.token)).expect(404);
  await request(app).get(`/link/code/${awaLink.code}`).expect(404);

  // Other people's data is intact.
  const bobList = (await request(app).get('/conversation/mine').set(auth(bob.token)).expect(200)).body;
  assert.deepEqual(bobList.items.map((c) => c.id), [untouched]);
});

test('deleting an account requires authentication', async () => {
  await request(app).delete('/identity/me').set('x-forwarded-for', nextIp()).expect(401);
});

test.after(async () => {
  await pool.end();
});
