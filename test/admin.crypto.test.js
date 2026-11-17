// Unit tests for back-office crypto (no database needed).
const test = require('node:test');
const assert = require('node:assert/strict');
const c = require('../src/modules/admin/admin.crypto');

test('TOTP matches the RFC 6238 reference vector', () => {
  // RFC 6238 appendix B, SHA-1 secret "12345678901234567890", T = 59 s → 94287082.
  const secret = c.base32Encode(Buffer.from('12345678901234567890'));
  assert.equal(c.hotp(c.base32Decode(secret), 1), '287082');
  assert.equal(c.verifyTotp(secret, '287082', { nowMs: 59_000 }), 1);
});

test('TOTP accepts one step of clock drift and refuses replays', () => {
  const secret = c.generateTotpSecret();
  const now = 1_800_000_000_000;
  const step = c.totpStep(now);
  const previous = c.hotp(c.base32Decode(secret), step - 1);
  assert.equal(c.verifyTotp(secret, previous, { nowMs: now }), step - 1);
  assert.equal(c.verifyTotp(secret, previous, { nowMs: now, lastStep: step - 1 }), null);
  assert.equal(c.verifyTotp(secret, '12345', { nowMs: now }), null);
  assert.equal(c.verifyTotp(secret, 'abcdef', { nowMs: now }), null);
});

test('passwords are salted and verified in constant time', async () => {
  const h1 = await c.hashPassword('correct horse battery');
  const h2 = await c.hashPassword('correct horse battery');
  assert.notEqual(h1, h2);
  assert.equal(await c.verifyPassword('correct horse battery', h1), true);
  assert.equal(await c.verifyPassword('wrong', h1), false);
  assert.equal(await c.verifyPassword('anything', null), false);
});

test('TOTP secrets are encrypted at rest', () => {
  const secret = c.generateTotpSecret();
  const enc = c.encryptSecret(secret);
  assert.ok(!enc.includes(secret));
  assert.equal(c.decryptSecret(enc), secret);
  const tampered = enc.slice(0, -2) + (enc.endsWith('A') ? 'B' : 'A') + enc.slice(-1);
  assert.throws(() => c.decryptSecret(tampered));
});

test('temporary passwords and user refs have the expected shape', () => {
  assert.match(c.generateTemporaryPassword(), /^[A-Za-z2-9]{4}(-[A-Za-z2-9]{4}){3}$/);
  const ref = c.userRef('11111111-1111-4111-8111-111111111111');
  assert.match(ref, /^[0-9a-f]{10}$/);
  assert.equal(ref, c.userRef('11111111-1111-4111-8111-111111111111'));
  assert.notEqual(ref, c.userRef('22222222-2222-4222-8222-222222222222'));
});
