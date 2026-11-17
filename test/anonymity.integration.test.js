// Integration tests for anonymity (need the test database, run in CI).
//
// Scenario: Awa and Bob both use the app and both own a link. Awa writes
// anonymously on Bob's link. Bob must not be able to tell it is Awa — neither
// by her name, nor by comparing ids with what he gets when he opens her link.
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const app = require('../src/app');
const pool = require('../src/config/database');
const { maskedAnonymousId } = require('../src/utils/participantMask');

let ip = 0;
const nextIp = () => `198.19.0.${(ip++ % 200) + 20}`;
const auth = (token) => ({ Authorization: `Bearer ${token}` });

const init = async (client) => {
  const res = await request(app)
    .post('/identity/init')
    .set('x-forwarded-for', nextIp())
    .send(client ? { client } : {})
    .expect(201);
  return { token: res.body.token, user: res.body.user };
};

const linkOf = async (owner) =>
  (await request(app).post('/link').set(auth(owner.token))).body;

const resolve = async (visitor, link) =>
  (await request(app)
    .post('/conversation/resolve-link')
    .set(auth(visitor.token))
    .send({ inviteCode: link.code })
    .expect(200)).body;

const send = (sender, conversationId, content) =>
  request(app)
    .post('/message')
    .set(auth(sender.token))
    .send({ conversationId, content })
    .expect(201);

test('an app user writing anonymously cannot be identified by the link owner', async () => {
  const awa = await init();
  const bob = await init();
  const awaLink = await linkOf(awa);
  const bobLink = await linkOf(bob);

  // Awa writes anonymously on Bob's link.
  const asAwa = await resolve(awa, bobLink);
  const conversationId = asAwa.conversationId;
  await send(awa, conversationId, 'devine qui je suis');

  // Awa gets a per-conversation alias, not her public pseudo.
  assert.ok(asAwa.anonymousPseudo);
  assert.notEqual(asAwa.anonymousPseudo, awa.user.pseudo);

  // --- What Bob receives ---
  const convForBob = (await request(app)
    .get(`/conversation/${conversationId}`).set(auth(bob.token)).expect(200)).body;
  const listForBob = (await request(app)
    .get('/conversation/mine').set(auth(bob.token)).expect(200)).body;
  const messagesForBob = (await request(app)
    .get(`/message/${conversationId}`).set(auth(bob.token)).expect(200)).body;

  const everythingBobSees = JSON.stringify([convForBob, listForBob, messagesForBob]);
  assert.ok(!everythingBobSees.includes(awa.user.id), 'Awa\'s real id never reaches Bob');
  assert.ok(!everythingBobSees.includes(awa.user.pseudo), 'Awa\'s public pseudo never reaches Bob');

  const masked = maskedAnonymousId(conversationId);
  assert.equal(convForBob.anonymous_id, masked);
  assert.equal(convForBob.anonymous_pseudo, asAwa.anonymousPseudo);
  assert.equal(messagesForBob[0].sender_id, masked);
  assert.equal(listForBob.items.find((c) => c.id === conversationId).last_message_sender_id, masked);

  // --- The comparison attack: Bob opens Awa's link to read her owner id ---
  const bobOnAwaLink = await resolve(bob, awaLink);
  assert.equal(bobOnAwaLink.ownerId, awa.user.id); // public by design (her link)
  assert.notEqual(bobOnAwaLink.ownerId, convForBob.anonymous_id); // …but matches nothing Bob holds

  // Bob's reply still reads as his own, Awa still recognises hers.
  const reply = await send(bob, conversationId, 'aucune idée');
  assert.equal(reply.body.sender_id, bob.user.id);
  const messagesForAwa = (await request(app)
    .get(`/message/${conversationId}`).set(auth(awa.token)).expect(200)).body;
  assert.ok(messagesForAwa.some((m) => m.sender_id === awa.user.id));
  assert.ok(messagesForAwa.some((m) => m.sender_id === bob.user.id));
});

test('the same app user gets a different alias on each link', async () => {
  const awa = await init();
  const bob = await init();
  const chloe = await init();

  const onBob = await resolve(awa, await linkOf(bob));
  const onChloe = await resolve(awa, await linkOf(chloe));

  assert.notEqual(onBob.anonymousPseudo, awa.user.pseudo);
  assert.notEqual(onChloe.anonymousPseudo, awa.user.pseudo);
  // Re-opening the same link keeps the same alias.
  const again = await resolve(awa, await linkOf(bob));
  assert.equal(again.conversationId, onBob.conversationId);
  assert.equal(again.anonymousPseudo, onBob.anonymousPseudo);
});

test('a web visitor keeps the pseudo shown to them on the web', async () => {
  const bob = await init();
  const web = await init('web');
  const resolved = await resolve(web, await linkOf(bob));
  assert.equal(resolved.anonymousPseudo, web.user.pseudo);
});

test('reporting a conversation does not reveal who the other participant is', async () => {
  const awa = await init();
  const bob = await init();
  const { conversationId } = await resolve(awa, await linkOf(bob));
  await send(awa, conversationId, 'message signalé');

  const res = await request(app)
    .post('/moderation/report')
    .set(auth(bob.token))
    .send({ conversationId, reason: 'test' })
    .expect(201);

  const body = JSON.stringify(res.body);
  assert.ok(!body.includes(awa.user.id));
  assert.ok(!body.includes(awa.user.pseudo));
});

test.after(async () => {
  await pool.end();
});
