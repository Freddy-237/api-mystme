const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { randomUUID } = require('crypto');

const app = require('../src/app');
const pool = require('../src/config/database');

const expectDuplicateViolation = (error) => {
  assert.equal(error?.code, '23505');
  return true;
};

async function initIdentity() {
  const res = await request(app).post('/identity/init').expect(201);
  return { token: res.body.token, user: res.body.user };
}

test('schema enforces unique conversation per link and anonymous user', async () => {
  const owner = await initIdentity();
  const anon = await initIdentity();

  const linkRes = await request(app)
    .post('/link')
    .set('Authorization', `Bearer ${owner.token}`)
    .expect(201);

  const linkId = linkRes.body.id;

  const firstRes = await request(app)
    .post('/conversation/resolve-link')
    .set('Authorization', `Bearer ${anon.token}`)
    .send({ inviteCode: linkRes.body.code })
    .expect(200);

  await assert.rejects(
    () => pool.query(
      `INSERT INTO conversations (id, owner_id, anonymous_id, link_id)
       VALUES ($1, $2, $3, $4)`,
      [randomUUID(), owner.user.id, anon.user.id, linkId],
    ),
    expectDuplicateViolation,
  );

  const countRes = await pool.query(
    'SELECT COUNT(*)::int AS cnt FROM conversations WHERE link_id = $1 AND anonymous_id = $2',
    [linkId, anon.user.id],
  );
  assert.equal(countRes.rows[0].cnt, 1);
  assert.equal(typeof firstRes.body.conversationId, 'string');
});

test('schema enforces unique subscription purchase token per store', async () => {
  const user = await initIdentity();
  const purchaseToken = `schema-sub-token-${randomUUID()}`;

  await pool.query(
    `INSERT INTO subscriptions (id, user_id, product_id, store, purchase_token, status)
     VALUES ($1, $2, 'mystme_premium_monthly', 'google', $3, 'active')`,
    [randomUUID(), user.user.id, purchaseToken],
  );

  await assert.rejects(
    () => pool.query(
      `INSERT INTO subscriptions (id, user_id, product_id, store, purchase_token, status)
       VALUES ($1, $2, 'mystme_premium_monthly', 'google', $3, 'active')`,
      [randomUUID(), user.user.id, purchaseToken],
    ),
    expectDuplicateViolation,
  );
});

test('schema enforces unique unlock purchase token per store', async () => {
  const owner = await initIdentity();
  const anon = await initIdentity();
  const purchaseToken = `schema-unlock-token-${randomUUID()}`;

  const linkRes = await request(app)
    .post('/link')
    .set('Authorization', `Bearer ${owner.token}`)
    .expect(201);

  const resolveRes = await request(app)
    .post('/conversation/resolve-link')
    .set('Authorization', `Bearer ${anon.token}`)
    .send({ inviteCode: linkRes.body.code })
    .expect(200);

  const conversationId = resolveRes.body.conversationId;

  await pool.query(
    `INSERT INTO conversation_unlocks (id, user_id, conversation_id, product_id, store, purchase_token)
     VALUES ($1, $2, $3, 'mystme_unlock_single', 'google', $4)`,
    [randomUUID(), anon.user.id, conversationId, purchaseToken],
  );

  await assert.rejects(
    () => pool.query(
      `INSERT INTO conversation_unlocks (id, user_id, conversation_id, product_id, store, purchase_token)
       VALUES ($1, $2, $3, 'mystme_unlock_single', 'google', $4)`,
      [randomUUID(), owner.user.id, conversationId, purchaseToken],
    ),
    expectDuplicateViolation,
  );
});