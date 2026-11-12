const test = require('node:test');
const assert = require('node:assert/strict');

const { __private } = require('../src/config/socket');

test('normalizeSocketMediaPayload rejects unsupported media types', () => {
  assert.throws(
    () => __private.normalizeSocketMediaPayload({
      conversationId: 'conv-1',
      mediaType: 'exe',
      bytes: [1, 2, 3],
    }),
    /Type de media invalide/,
  );
});

test('normalizeSocketMediaPayload rejects oversized files', () => {
  const tooLarge = Buffer.alloc((25 * 1024 * 1024) + 1, 1);

  assert.throws(
    () => __private.normalizeSocketMediaPayload({
      conversationId: 'conv-1',
      mediaType: 'file',
      bytes: tooLarge,
    }),
    /Fichier trop volumineux/,
  );
});

test('normalizeSocketMediaPayload normalizes valid payloads', () => {
  const result = __private.normalizeSocketMediaPayload({
    conversationId: 'conv-1',
    mediaType: 'IMAGE',
    filename: ' hello.png ',
    caption: ' salut ',
    bytes: [1, 2, 3],
  });

  assert.equal(result.conversationId, 'conv-1');
  assert.equal(result.mediaType, 'image');
  assert.equal(result.filename, 'hello.png');
  assert.equal(result.caption, 'salut');
  assert.ok(Buffer.isBuffer(result.buffer));
  assert.equal(result.buffer.length, 3);
});

test('toSocketErrorPayload returns a normalized realtime error shape', () => {
  const payload = __private.toSocketErrorPayload({
    message: 'Non autorisé',
    event: 'send_media',
    code: 'FORBIDDEN',
    requestId: 'sock-1',
  });

  assert.deepEqual(payload, {
    error: true,
    code: 'FORBIDDEN',
    message: 'Non autorisé',
    event: 'send_media',
    requestId: 'sock-1',
  });
});