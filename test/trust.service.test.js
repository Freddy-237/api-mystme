/**
 * Unit tests for trust.service – trust levels, upgrade logic.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const TRUST_LEVELS = ['new', 'known', 'trusted', 'revealed'];

// ── Mirror of upgradeTrust pure logic for unit testing ──

function computeUpgrade(currentStatus, targetStatus) {
  const currentIndex = TRUST_LEVELS.indexOf(currentStatus);

  // With explicit target
  if (targetStatus && TRUST_LEVELS.includes(targetStatus)) {
    const targetIndex = TRUST_LEVELS.indexOf(targetStatus);
    if (targetIndex <= currentIndex) return currentStatus; // already at or above
    return targetStatus;
  }

  // Auto-increment
  if (currentIndex >= TRUST_LEVELS.length - 1) return currentStatus;
  return TRUST_LEVELS[currentIndex + 1];
}

// ── TRUST_LEVELS constant ──

test('TRUST_LEVELS has 4 levels in correct order', () => {
  assert.deepEqual(TRUST_LEVELS, ['new', 'known', 'trusted', 'revealed']);
});

test('TRUST_LEVELS indices are sequential', () => {
  assert.equal(TRUST_LEVELS.indexOf('new'), 0);
  assert.equal(TRUST_LEVELS.indexOf('known'), 1);
  assert.equal(TRUST_LEVELS.indexOf('trusted'), 2);
  assert.equal(TRUST_LEVELS.indexOf('revealed'), 3);
});

// ── Auto-increment (no target) ──

test('upgradeTrust auto-increments from new → known', () => {
  assert.equal(computeUpgrade('new', null), 'known');
});

test('upgradeTrust auto-increments from known → trusted', () => {
  assert.equal(computeUpgrade('known', null), 'trusted');
});

test('upgradeTrust auto-increments from trusted → revealed', () => {
  assert.equal(computeUpgrade('trusted', null), 'revealed');
});

test('upgradeTrust stays at revealed (max level)', () => {
  assert.equal(computeUpgrade('revealed', null), 'revealed');
});

// ── Explicit target (jump) ──

test('upgradeTrust jumps from new → trusted', () => {
  assert.equal(computeUpgrade('new', 'trusted'), 'trusted');
});

test('upgradeTrust jumps from new → revealed', () => {
  assert.equal(computeUpgrade('new', 'revealed'), 'revealed');
});

test('upgradeTrust jumps from known → revealed', () => {
  assert.equal(computeUpgrade('known', 'revealed'), 'revealed');
});

// ── Target at or below current level ──

test('upgradeTrust returns current when target equals current', () => {
  assert.equal(computeUpgrade('trusted', 'trusted'), 'trusted');
});

test('upgradeTrust returns current when target is below current', () => {
  assert.equal(computeUpgrade('revealed', 'known'), 'revealed');
});

test('upgradeTrust returns current when target is "new" but already "known"', () => {
  assert.equal(computeUpgrade('known', 'new'), 'known');
});

// ── Invalid target falls back to auto-increment ──

test('upgradeTrust auto-increments when target is invalid string', () => {
  assert.equal(computeUpgrade('new', 'invalid_level'), 'known');
});

test('upgradeTrust auto-increments when target is undefined', () => {
  assert.equal(computeUpgrade('known', undefined), 'trusted');
});

test('upgradeTrust auto-increments when target is empty string', () => {
  assert.equal(computeUpgrade('trusted', ''), 'revealed');
});

// ── Edge cases ──

test('every level can be reached from new via sequential upgrades', () => {
  let current = 'new';
  const visited = [current];
  for (let i = 0; i < 10; i++) {
    const next = computeUpgrade(current, null);
    if (next === current) break; // at max
    current = next;
    visited.push(current);
  }
  assert.deepEqual(visited, ['new', 'known', 'trusted', 'revealed']);
});

test('jump from every level to revealed always works', () => {
  for (const level of TRUST_LEVELS) {
    const result = computeUpgrade(level, 'revealed');
    assert.equal(result, 'revealed');
  }
});
