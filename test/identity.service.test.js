const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

// ─── Inline pure-function extractions to test without DB ───

const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const RECOVERY_RAW_LENGTH = 20;

const hashRecoveryKey = (value) =>
  crypto.createHash('sha256').update(value).digest('hex');

const normalizeRecoveryKey = (value) =>
  String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');

const formatRecoveryKey = (raw) =>
  raw.match(/.{1,5}/g)?.join('-') || raw;

const createRecoveryKey = () => {
  const bytes = crypto.randomBytes(RECOVERY_RAW_LENGTH);
  let out = '';
  for (let i = 0; i < RECOVERY_RAW_LENGTH; i++) {
    out += RECOVERY_ALPHABET[bytes[i] % RECOVERY_ALPHABET.length];
  }
  return out;
};

const normalizeEmail = (email) => String(email || '').trim().toLowerCase();

const isValidEmail = (email) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());

const generateOtpCode = () => {
  const num = crypto.randomInt(0, 1000000);
  return String(num).padStart(6, '0');
};

// ─── Recovery key generation ───

test('createRecoveryKey returns string of correct length', () => {
  const key = createRecoveryKey();
  assert.equal(key.length, RECOVERY_RAW_LENGTH);
});

test('createRecoveryKey uses only allowed characters', () => {
  for (let i = 0; i < 50; i++) {
    const key = createRecoveryKey();
    for (const ch of key) {
      assert.ok(
        RECOVERY_ALPHABET.includes(ch),
        `Unexpected character '${ch}' in key '${key}'`,
      );
    }
  }
});

test('createRecoveryKey produces different keys', () => {
  const keys = new Set();
  for (let i = 0; i < 100; i++) {
    keys.add(createRecoveryKey());
  }
  assert.ok(keys.size >= 95, `Expected unique keys, got ${keys.size}/100`);
});

// ─── Recovery key formatting ───

test('formatRecoveryKey groups by 5 chars with dash', () => {
  const raw = 'ABCDE12345FGHIJ67890';
  assert.equal(formatRecoveryKey(raw), 'ABCDE-12345-FGHIJ-67890');
});

test('formatRecoveryKey handles short input', () => {
  assert.equal(formatRecoveryKey('ABC'), 'ABC');
});

test('formatRecoveryKey handles empty string', () => {
  assert.equal(formatRecoveryKey(''), '');
});

// ─── Recovery key normalization ───

test('normalizeRecoveryKey uppercases and strips non-alphanumeric', () => {
  assert.equal(normalizeRecoveryKey('abcde-12345-fghij'), 'ABCDE12345FGHIJ');
});

test('normalizeRecoveryKey handles null/undefined', () => {
  assert.equal(normalizeRecoveryKey(null), '');
  assert.equal(normalizeRecoveryKey(undefined), '');
});

test('normalizeRecoveryKey strips spaces and special chars', () => {
  assert.equal(normalizeRecoveryKey('  AB CD!@#E  '), 'ABCDE');
});

// ─── Recovery key hashing ───

test('hashRecoveryKey is deterministic', () => {
  const h1 = hashRecoveryKey('TESTKEY123');
  const h2 = hashRecoveryKey('TESTKEY123');
  assert.equal(h1, h2);
});

test('hashRecoveryKey produces different hashes for different inputs', () => {
  const h1 = hashRecoveryKey('TESTKEY123');
  const h2 = hashRecoveryKey('TESTKEY124');
  assert.notEqual(h1, h2);
});

test('hashRecoveryKey returns hex string of 64 chars (SHA-256)', () => {
  const h = hashRecoveryKey('anything');
  assert.equal(h.length, 64);
  assert.match(h, /^[a-f0-9]{64}$/);
});

// ─── Round-trip: create → normalize → hash → match ───

test('recovery key round-trip: create → format → normalize → hash matches', () => {
  const raw = createRecoveryKey();
  const formatted = formatRecoveryKey(raw);
  const normalized = normalizeRecoveryKey(formatted);
  assert.equal(normalized, raw);
  assert.equal(hashRecoveryKey(normalized), hashRecoveryKey(raw));
});

// ─── Email normalization ───

test('normalizeEmail lowercases and trims', () => {
  assert.equal(normalizeEmail('  User@Example.COM  '), 'user@example.com');
});

test('normalizeEmail handles null/undefined', () => {
  assert.equal(normalizeEmail(null), '');
  assert.equal(normalizeEmail(undefined), '');
});

// ─── Email validation ───

test('isValidEmail accepts valid emails', () => {
  assert.ok(isValidEmail('user@example.com'));
  assert.ok(isValidEmail('a@b.co'));
  assert.ok(isValidEmail('test+tag@subdomain.example.org'));
});

test('isValidEmail rejects invalid emails', () => {
  assert.ok(!isValidEmail(''));
  assert.ok(!isValidEmail('notanemail'));
  assert.ok(!isValidEmail('@missing.com'));
  assert.ok(!isValidEmail('user@'));
  assert.ok(!isValidEmail('user @space.com'));
  assert.ok(!isValidEmail(null));
  assert.ok(!isValidEmail(undefined));
});

// ─── OTP code generation ───

test('generateOtpCode returns 6-digit zero-padded string', () => {
  for (let i = 0; i < 100; i++) {
    const code = generateOtpCode();
    assert.equal(code.length, 6);
    assert.match(code, /^\d{6}$/);
  }
});

test('generateOtpCode produces varied codes', () => {
  const codes = new Set();
  for (let i = 0; i < 50; i++) {
    codes.add(generateOtpCode());
  }
  assert.ok(codes.size >= 30, `Expected variety, got ${codes.size}/50 unique codes`);
});

// ─── OTP hash verification logic ───

test('OTP hash matches when email+code are correct', () => {
  const email = 'user@example.com';
  const code = '123456';
  const hash = hashRecoveryKey(`${email}:${code}`);
  assert.equal(hashRecoveryKey(`${email}:${code}`), hash);
});

test('OTP hash fails when code is wrong', () => {
  const email = 'user@example.com';
  const correct = hashRecoveryKey(`${email}:123456`);
  const wrong = hashRecoveryKey(`${email}:654321`);
  assert.notEqual(correct, wrong);
});

test('OTP hash fails when email differs', () => {
  const h1 = hashRecoveryKey('a@b.com:123456');
  const h2 = hashRecoveryKey('x@y.com:123456');
  assert.notEqual(h1, h2);
});
