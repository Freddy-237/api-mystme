const test = require('node:test');
const assert = require('node:assert/strict');

const createSocketGuard = require('../src/utils/socketRateLimit');

const createMemoryStore = () => {
  const buckets = new Map();
  return {
    async consume({ scope, key, windowMs, max }) {
      const bucketStartMs = Math.floor(Date.now() / windowMs) * windowMs;
      const bucketKey = `${scope}:${key}:${bucketStartMs}`;
      const hits = (buckets.get(bucketKey) || 0) + 1;
      buckets.set(bucketKey, hits);
      return {
        allowed: hits <= max,
        remaining: Math.max(0, max - hits),
      };
    },
  };
};

// Stub socket with basic emit
function fakeSocket(userId = 'u1') {
  const emitted = [];
  return {
    id: 'sock1',
    user: { userId },
    emit(event, data) {
      emitted.push({ event, data });
    },
    get _emitted() {
      return emitted;
    },
  };
}

test('allows events within the rate limit', () => {
  const guard = createSocketGuard('test_event', { windowMs: 1000, max: 3 }, createMemoryStore());
  const socket = fakeSocket();
  const check = guard(socket);

  return Promise.all([
    check().then((value) => assert.equal(value, true)),
    check().then((value) => assert.equal(value, true)),
    check().then((value) => assert.equal(value, true)),
  ]).then(() => {
    assert.equal(socket._emitted.length, 0, 'no error emitted while within limit');
  });
});

test('blocks events exceeding the rate limit', async () => {
  const guard = createSocketGuard('test_event', { windowMs: 10_000, max: 2 }, createMemoryStore());
  const socket = fakeSocket();
  const check = guard(socket);

  assert.equal(await check(), true);
  assert.equal(await check(), true);
  assert.equal(await check(), false, 'third call exceeds limit');
  assert.equal(socket._emitted.length, 1, 'error emitted on third call');
  assert.equal(socket._emitted[0].event, 'error');
  assert.equal(socket._emitted[0].data.event, 'test_event');
});

test('sliding window expires old timestamps', async () => {
  const guard = createSocketGuard('test_event', { windowMs: 50, max: 1 }, createMemoryStore());
  const socket = fakeSocket();
  const check = guard(socket);

  assert.equal(await check(), true);
  assert.equal(await check(), false, 'immediate second call blocked');

  // Wait for the window to expire
  await new Promise((r) => setTimeout(r, 60));

  assert.equal(await check(), true, 'call after window expired should succeed');
});

test('separate sockets have independent buckets', async () => {
  const guard = createSocketGuard('test_event', { windowMs: 10_000, max: 1 }, createMemoryStore());

  const socket1 = fakeSocket('user1');
  const socket2 = fakeSocket('user2');

  const check1 = guard(socket1);
  const check2 = guard(socket2);

  assert.equal(await check1(), true);
  assert.equal(await check2(), true, 'socket2 should have its own bucket');
  assert.equal(await check1(), false, 'socket1 bucket exhausted');
  assert.equal(await check2(), false, 'socket2 bucket exhausted');
});

test('default options are windowMs=10000 max=10', async () => {
  const guard = createSocketGuard('default_event', undefined, createMemoryStore());
  const socket = fakeSocket();
  const check = guard(socket);

  // Call 10 times — all should pass
  for (let i = 0; i < 10; i++) {
    assert.equal(await check(), true, `call ${i + 1} should pass`);
  }
  // 11th should fail
  assert.equal(await check(), false, '11th call should be blocked');
});
