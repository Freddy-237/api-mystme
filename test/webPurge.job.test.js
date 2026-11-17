// Purge of expired web identities (no database needed: repositories are stubbed).
const test = require('node:test');
const assert = require('node:assert/strict');

const pool = require('../src/config/database');
const identityRepository = require('../src/modules/identity/identity.repository');
const uploadService = require('../src/services/upload.service');
const { WEB_LOCK_DAYS } = require('../src/config/webTrial');

const stub = (t, target, impls) => {
  for (const [name, impl] of Object.entries(impls)) {
    const original = target[name];
    target[name] = impl;
    t.after(() => { target[name] = original; });
  }
};

// withTransaction only needs a client that accepts BEGIN/COMMIT/ROLLBACK.
const stubTransactions = (t) => {
  const statements = [];
  stub(t, pool, {
    connect: async () => ({
      query: async (sql) => { statements.push(sql); return { rows: [] }; },
      release: () => {},
    }),
  });
  return statements;
};

test('purges every expired web identity, one transaction each', async (t) => {
  const statements = stubTransactions(t);
  const deleted = [];
  stub(t, identityRepository, {
    findPurgeableWebIdentityIds: async (lockDays, limit) => {
      assert.equal(lockDays, WEB_LOCK_DAYS);
      assert.equal(limit, 50);
      return ['web-1', 'web-2'];
    },
    deleteAccountData: async (_client, id, options) => {
      assert.deepEqual(options, { webOnly: true });
      deleted.push(id);
      return { userIds: [id], conversationIds: [], media: [], peers: [] };
    },
  });

  // Required after the stubs so the job picks them up through the module objects.
  const { runOnce } = require('../src/jobs/webPurge.job');
  assert.equal(await runOnce({ batchSize: 50 }), 2);
  assert.deepEqual(deleted, ['web-1', 'web-2']);
  assert.equal(statements.filter((sql) => sql === 'COMMIT').length, 2);
});

test('one failing identity does not stop the others', async (t) => {
  const statements = stubTransactions(t);
  stub(t, identityRepository, {
    findPurgeableWebIdentityIds: async () => ['bad', 'gone', 'good'],
    deleteAccountData: async (_client, id) => {
      if (id === 'bad') throw new Error('boom');
      if (id === 'gone') return null; // no longer a web identity
      return { userIds: [id], conversationIds: [], media: [], peers: [] };
    },
  });

  const { runOnce } = require('../src/jobs/webPurge.job');
  assert.equal(await runOnce(), 1);
  assert.equal(statements.filter((sql) => sql === 'ROLLBACK').length, 1);
});

test('upload service exposes the media cleanup used by the purge', () => {
  assert.equal(typeof uploadService.deleteMedia, 'function');
});
