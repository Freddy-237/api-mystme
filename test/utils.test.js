/**
 * Unit tests for utility modules: generatePseudo, generateAvatar, AppError.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

// ── generatePseudo ──

const ADJECTIVES = [
  'Silent', 'Mystic', 'Hidden', 'Cosmic', 'Shadow',
  'Secret', 'Frozen', 'Dark', 'Lost', 'Wild',
  'Neon', 'Crystal', 'Phantom', 'Stellar', 'Velvet',
];

const NOUNS = [
  'Fox', 'Raven', 'Echo', 'Wolf', 'Ghost',
  'Storm', 'Flame', 'Moon', 'Star', 'Night',
  'Spark', 'Frost', 'Dream', 'Shade', 'Wing',
];

// Import real modules
const generatePseudo = require('../src/utils/generatePseudo');
const generateAvatar = require('../src/utils/generateAvatar');
const AppError = require('../src/utils/AppError');

test('generatePseudo returns AdjectiveNoun_NNNN format', () => {
  for (let i = 0; i < 50; i++) {
    const pseudo = generatePseudo();
    assert.match(pseudo, /^[A-Z][a-z]+[A-Z][a-z]+_\d{4}$/);
  }
});

test('generatePseudo uses only defined adjectives and nouns', () => {
  for (let i = 0; i < 100; i++) {
    const pseudo = generatePseudo();
    const match = pseudo.match(/^([A-Z][a-z]+)([A-Z][a-z]+)_(\d{4})$/);
    assert.ok(match, `Pseudo '${pseudo}' did not match pattern`);
    assert.ok(ADJECTIVES.includes(match[1]), `Adjective '${match[1]}' not in list`);
    assert.ok(NOUNS.includes(match[2]), `Noun '${match[2]}' not in list`);
    const num = parseInt(match[3], 10);
    assert.ok(num >= 1000 && num <= 9999, `Number ${num} out of range`);
  }
});

test('generatePseudo produces varied output', () => {
  const pseudos = new Set();
  for (let i = 0; i < 50; i++) {
    pseudos.add(generatePseudo());
  }
  assert.ok(pseudos.size >= 30, `Expected variety, got ${pseudos.size}/50`);
});

// ── generateAvatar ──

test('generateAvatar returns DiceBear URL with given seed', () => {
  const url = generateAvatar('test123');
  assert.equal(url, 'https://api.dicebear.com/7.x/bottts/svg?seed=test123');
});

test('generateAvatar generates random seed when no argument', () => {
  const url = generateAvatar();
  assert.ok(url.startsWith('https://api.dicebear.com/7.x/bottts/svg?seed='));
  assert.ok(url.length > 'https://api.dicebear.com/7.x/bottts/svg?seed='.length);
});

test('generateAvatar generates random seed for empty string', () => {
  const url = generateAvatar('');
  assert.ok(url.startsWith('https://api.dicebear.com/7.x/bottts/svg?seed='));
});

test('generateAvatar generates random seed for null', () => {
  const url = generateAvatar(null);
  assert.ok(url.startsWith('https://api.dicebear.com/7.x/bottts/svg?seed='));
});

test('generateAvatar returns consistent URL for same seed', () => {
  const a = generateAvatar('myseed');
  const b = generateAvatar('myseed');
  assert.equal(a, b);
});

// ── AppError ──

test('AppError is an instance of Error', () => {
  const err = new AppError('test', 400);
  assert.ok(err instanceof Error);
  assert.ok(err instanceof AppError);
});

test('AppError has correct message and statusCode', () => {
  const err = new AppError('Not found', 404);
  assert.equal(err.message, 'Not found');
  assert.equal(err.statusCode, 404);
});

test('AppError defaults to statusCode 500', () => {
  const err = new AppError('Server error');
  assert.equal(err.statusCode, 500);
});

test('AppError name is "AppError"', () => {
  const err = new AppError('x');
  assert.equal(err.name, 'AppError');
});

test('AppError has a stack trace', () => {
  const err = new AppError('traced', 422);
  assert.ok(err.stack);
  assert.ok(err.stack.includes('AppError'));
});

test('AppError with various status codes', () => {
  for (const code of [400, 401, 403, 404, 409, 422, 500, 502, 503]) {
    const err = new AppError(`Error ${code}`, code);
    assert.equal(err.statusCode, code);
  }
});
