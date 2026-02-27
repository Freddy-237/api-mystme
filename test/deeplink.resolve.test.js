const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const app = require('../src/app');

test('resolve-link creates or reuses conversation and returns deep-link context', async () => {
  const ownerInit = await request(app).post('/identity/init').expect(201);
  const ownerToken = ownerInit.body?.token;
  const ownerPseudo = ownerInit.body?.user?.pseudo;

  assert.equal(typeof ownerToken, 'string');
  assert.equal(typeof ownerPseudo, 'string');

  const linkRes = await request(app)
    .post('/link')
    .set('Authorization', `Bearer ${ownerToken}`)
    .expect(201);

  const inviteCode = linkRes.body?.code;
  assert.equal(typeof inviteCode, 'string');

  const anonInit = await request(app).post('/identity/init').expect(201);
  const anonToken = anonInit.body?.token;

  assert.equal(typeof anonToken, 'string');

  const firstResolve = await request(app)
    .post('/conversation/resolve-link')
    .set('Authorization', `Bearer ${anonToken}`)
    .send({ inviteCode })
    .expect(200);

  assert.equal(typeof firstResolve.body?.conversationId, 'string');
  assert.equal(firstResolve.body?.targetPseudo, ownerPseudo);

  const secondResolve = await request(app)
    .post('/conversation/resolve-link')
    .set('Authorization', `Bearer ${anonToken}`)
    .send({ inviteCode })
    .expect(200);

  assert.equal(
    secondResolve.body?.conversationId,
    firstResolve.body?.conversationId,
    'resolve-link should be idempotent for same user + invite code',
  );
});
