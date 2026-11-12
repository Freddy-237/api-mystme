const test = require('node:test');
const assert = require('node:assert/strict');

const { __private } = require('../src/config/socket');

test('getPresenceAudienceUserIds returns unique peer ids only', () => {
  const audience = __private.getPresenceAudienceUserIds(
    [
      { owner_id: 'user-a', anonymous_id: 'user-b' },
      { owner_id: 'user-c', anonymous_id: 'user-a' },
      { owner_id: 'user-a', anonymous_id: 'user-b' },
    ],
    'user-a',
  );

  assert.deepEqual(audience.sort(), ['user-b', 'user-c']);
});

test('emitPresenceToPeers emits only to shared conversation peers', async () => {
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
    async findByParticipantWithUnread(userId) {
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
    {
      room: 'user:user-c',
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
    async findByParticipantWithUnread() {
      throw new Error('db unavailable');
    },
  };

  await assert.doesNotReject(() =>
    __private.emitPresenceToPeers(emitter, 'user-a', 'user_offline', repository),
  );
});