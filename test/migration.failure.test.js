const test = require('node:test');
const assert = require('node:assert/strict');

const pool = require('../src/config/database');
const runMigration = require('../src/database/runMigration');

test('runMigration rejects when a database migration operation fails', async (t) => {
  const migrationError = new Error('simulated migration failure');
  t.mock.method(pool, 'query', async () => {
    throw migrationError;
  });

  await assert.rejects(
    runMigration({ closePool: false }),
    (error) => error === migrationError,
  );
});

test('runMigration closes the pool after a failure when it owns the pool', async (t) => {
  const migrationError = new Error('simulated migration failure');
  let closed = false;
  t.mock.method(pool, 'query', async () => {
    throw migrationError;
  });
  t.mock.method(pool, 'end', async () => {
    closed = true;
  });

  await assert.rejects(runMigration(), (error) => error === migrationError);
  assert.equal(closed, true);
});
