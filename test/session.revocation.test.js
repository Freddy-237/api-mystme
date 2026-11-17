// Sessions are revocable: a token is only valid for the session_version it
// was issued for (no database needed).
const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

const env = require('../src/config/env');
const generateToken = require('../src/utils/generateToken');
const identityRepository = require('../src/modules/identity/identity.repository');
const { authenticateToken } = require('../src/modules/identity/identity.auth');

const stubUser = (t, user) => {
  const original = identityRepository.findAuthStateById;
  identityRepository.findAuthStateById = async () => user;
  t.after(() => { identityRepository.findAuthStateById = original; });
};

test('token matching the current session version is accepted', async (t) => {
  stubUser(t, { id: 'u1', is_banned: false, session_version: 2 });
  const user = await authenticateToken(generateToken('u1', 2));
  assert.equal(user.id, 'u1');
});

test('token issued before a logout is rejected', async (t) => {
  stubUser(t, { id: 'u1', is_banned: false, session_version: 1 });
  await assert.rejects(
    authenticateToken(generateToken('u1', 0)),
    (error) => error.statusCode === 401 && error.code === 'AUTH_INVALID',
  );
});

test('legacy token without a version keeps working until the first logout', async (t) => {
  const legacy = jwt.sign({ userId: 'u1' }, env.jwtSecret, { expiresIn: '1h' });

  stubUser(t, { id: 'u1', is_banned: false, session_version: 0 });
  assert.equal((await authenticateToken(legacy)).id, 'u1');
});

test('legacy token is rejected once the user has logged out', async (t) => {
  const legacy = jwt.sign({ userId: 'u1' }, env.jwtSecret, { expiresIn: '1h' });

  stubUser(t, { id: 'u1', is_banned: false, session_version: 1 });
  await assert.rejects(authenticateToken(legacy), (error) => error.statusCode === 401);
});
