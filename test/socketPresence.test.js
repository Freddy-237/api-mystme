const test = require('node:test');
const assert = require('node:assert/strict');

const { __private } = require('../src/config/socket');

test('getPresenceAudienceUserIds only targets anonymous correspondents of the owner', () => {
  const audience = __private.getPresenceAudienceUserIds(
    [
      { owner_id: 'user-a', anonymous_id: 'user-b' },
      { owner_id: 'user-c', anonymous_id: 'user-a' },
      { owner_id: 'user-a', anonymous_id: 'user-b' },
    ],
    'user-a',
  );

  // user-c owns a link user-a writes on anonymously: user-c must NOT see user-a online.
  assert.deepEqual(audience, ['user-b']);
});

test('emitPresenceToPeers shows the owner online to anonymous peers, never the reverse', async () => {
  const emitted = [];
  const emitter = {
    to(room) {
      return {
        emit(event, payload) {
          emitted.push({ room, event, payload });
        },
      };
    },
  };

  const repository = {
    async findOwnedConversationPeers(userId) {
      assert.equal(userId, 'user-a');
      return [
        { owner_id: 'user-a', anonymous_id: 'user-b' },
        { owner_id: 'user-c', anonymous_id: 'user-a' },
        { owner_id: 'user-a', anonymous_id: 'user-b' },
      ];
    },
  };

  await __private.emitPresenceToPeers(emitter, 'user-a', 'user_online', repository);

  assert.deepEqual(emitted, [
    {
      room: 'user:user-b',
      event: 'user_online',
      payload: { userId: 'user-a' },
    },
  ]);
});

test('emitPresenceToPeers fails closed without throwing', async () => {
  const emitter = {
    to() {
      return {
        emit() {
          throw new Error('should not emit when repository lookup fails');
        },
      };
    },
  };

  const repository = {
    async findOwnedConversationPeers() {
      throw new Error('db unavailable');
    },
  };

  await assert.doesNotReject(() =>
    __private.emitPresenceToPeers(emitter, 'user-a', 'user_offline', repository),
  );
});