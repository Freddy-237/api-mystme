// Unit tests for the anonymity guard (no database needed).
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  maskedAnonymousId,
  visibleUserId,
  broadcastUserId,
  conversationForViewer,
  messageForViewer,
  emitToParticipants,
} = require('../src/utils/participantMask');

const OWNER = '11111111-1111-4111-8111-111111111111';
const ANON = '22222222-2222-4222-8222-222222222222';
const conv = {
  id: '33333333-3333-4333-8333-333333333333',
  owner_id: OWNER,
  anonymous_id: ANON,
  last_message_sender_id: ANON,
};
const otherConv = { ...conv, id: '44444444-4444-4444-8444-444444444444' };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/;

test('masked id is a stable UUID, unrelated to the real id', () => {
  const masked = maskedAnonymousId(conv.id);
  assert.match(masked, UUID_RE);
  assert.equal(masked, maskedAnonymousId(conv.id));
  assert.notEqual(masked, ANON);
});

test('same anonymous user gets a different masked id in each conversation', () => {
  assert.notEqual(maskedAnonymousId(conv.id), maskedAnonymousId(otherConv.id));
});

test('owner never sees the anonymous real id in a conversation', () => {
  const seen = conversationForViewer(conv, OWNER);
  assert.equal(seen.owner_id, OWNER);
  assert.equal(seen.anonymous_id, maskedAnonymousId(conv.id));
  assert.equal(seen.last_message_sender_id, maskedAnonymousId(conv.id));
  assert.ok(!JSON.stringify(seen).includes(ANON));
  // The source object is not mutated.
  assert.equal(conv.anonymous_id, ANON);
});

test('anonymous participant keeps seeing real ids (their own + the public owner)', () => {
  assert.deepEqual(conversationForViewer(conv, ANON), conv);
});

test('owner sees anonymous messages under the masked id, own messages untouched', () => {
  const fromAnon = { id: 'm1', sender_id: ANON, reply_to_sender_id: OWNER };
  const fromOwner = { id: 'm2', sender_id: OWNER, reply_to_sender_id: ANON };

  const a = messageForViewer(fromAnon, conv, OWNER);
  assert.equal(a.sender_id, maskedAnonymousId(conv.id));
  assert.equal(a.reply_to_sender_id, OWNER);

  const b = messageForViewer(fromOwner, conv, OWNER);
  assert.equal(b.sender_id, OWNER);
  assert.equal(b.reply_to_sender_id, maskedAnonymousId(conv.id));

  // What the owner sees for a message matches what they see for the conversation,
  // so "is this message from my correspondent?" still works client-side.
  assert.equal(a.sender_id, conversationForViewer(conv, OWNER).anonymous_id);
});

test('anonymous participant still recognises their own messages', () => {
  const mine = { id: 'm1', sender_id: ANON };
  assert.equal(messageForViewer(mine, conv, ANON).sender_id, ANON);
});

test('visibleUserId / broadcastUserId', () => {
  assert.equal(visibleUserId(conv, ANON, OWNER), maskedAnonymousId(conv.id));
  assert.equal(visibleUserId(conv, ANON, ANON), ANON);
  assert.equal(visibleUserId(conv, OWNER, ANON), OWNER);
  assert.equal(visibleUserId(conv, null, OWNER), null);

  // Typing / read receipts sent to the other participant.
  assert.equal(broadcastUserId(conv, ANON), maskedAnonymousId(conv.id));
  assert.equal(broadcastUserId(conv, OWNER), OWNER);
  assert.equal(broadcastUserId(null, ANON), ANON);
});

test('emitToParticipants sends each participant their own view', () => {
  const emitted = [];
  const io = {
    to: (room) => ({ emit: (event, payload) => emitted.push({ room, event, payload }) }),
  };
  const message = { id: 'm1', sender_id: ANON };

  emitToParticipants(io, conv, 'new_message', (viewerId) => messageForViewer(message, conv, viewerId));

  assert.deepEqual(emitted, [
    { room: `user:${OWNER}`, event: 'new_message', payload: { id: 'm1', sender_id: maskedAnonymousId(conv.id) } },
    { room: `user:${ANON}`, event: 'new_message', payload: { id: 'm1', sender_id: ANON } },
  ]);
});
