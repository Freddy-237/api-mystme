const test = require('node:test');
const assert = require('node:assert/strict');
const firebaseAdmin = require('../src/config/firebaseAdmin');

test('exports messaging helpers without initializing Firebase at load time', () => {
  assert.equal(typeof firebaseAdmin.getMessaging, 'function');
  assert.equal(typeof firebaseAdmin.isFirebaseAdminConfigured, 'function');
});
