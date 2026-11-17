// Unit tests for PWA → app transfer (transaction + repository stubbed).
const test = require('node:test');
const assert = require('node:assert/strict');

// Replace withTransaction BEFORE loading the service (no database here).
const fakeClient = { query: async () => ({ rows: [] }) };
const wtPath = require.resolve('../src/utils/withTransaction');
require.cache[wtPath] = {
  id: wtPath, filename: wtPath, loaded: true,
  exports: async (work) => work(fakeClient),
};

const repo = require('../src/modules/transfer/transfer.repository');
const service = require('../src/modules/transfer/transfer.service');

const stub = (t, overrides) => {
  for (const [name, impl] of Object.entries(overrides)) {
    const original = repo[name];
    repo[name] = impl;
    t.after(() => { repo[name] = original; });
  }
};

const users = (...rows) => async () => new Map(rows.map((r) => [r.id, r]));
const webUser = { id: 'web-1', origin: 'web', is_banned: false, merged_into_user_id: null };
const appUser = { id: 'app-1', origin: 'app', is_banned: false, merged_into_user_id: null };
const validToken = {
  id: 'tok-1', user_id: 'web-1', consumed_at: null,
  expires_at: new Date(Date.now() + 60_000).toISOString(),
};

test('normalizeCode accepts the formats users will paste', () => {
  assert.equal(service.normalizeCode('abcd-2345'), 'ABCD2345');
  assert.equal(service.normalizeCode(' MYSTME:ABCD-2345 '), 'ABCD2345');
  assert.equal(service.normalizeCode('mystme abcd 2345'), 'ABCD2345');
});

test('only a web identity can request a transfer code', async (t) => {
  stub(t, { lockUsers: users(appUser) });
  await assert.rejects(
    service.createTransferCode('app-1'),
    (err) => err.code === 'NOT_A_WEB_IDENTITY',
  );
});

test('a new code invalidates the previous ones and only its hash is stored', async (t) => {
  let invalidated = false;
  let stored = null;
  stub(t, {
    lockUsers: users(webUser),
    invalidateActiveTokens: async () => { invalidated = true; },
    createToken: async (_c, row) => { stored = row; },
  });

  const { code, expiresAt } = await service.createTransferCode('web-1');
  assert.match(code, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.ok(invalidated);
  assert.equal(stored.codeHash, service.hashCode(service.normalizeCode(code)));
  assert.ok(!JSON.stringify(stored).includes(code.replace('-', '')), 'raw code never stored');
  const ttl = new Date(expiresAt).getTime() - Date.now();
  assert.ok(ttl > 29 * 60_000 && ttl <= 30 * 60_000);
});

const claimRejects = async (t, overrides, code, expected) => {
  stub(t, overrides);
  await assert.rejects(
    service.claimTransferCode('app-1', 'ABCD-2345'),
    (err) => err.code === code && (!expected || err.statusCode === expected),
  );
};

test('claim: malformed code', async () => {
  await assert.rejects(service.claimTransferCode('app-1', '123'), (e) => e.code === 'TRANSFER_CODE_INVALID');
});

test('claim: unknown code', async (t) => {
  await claimRejects(t, { findTokenByHashForUpdate: async () => undefined }, 'TRANSFER_CODE_INVALID', 400);
});

test('claim: code already used', async (t) => {
  await claimRejects(t, {
    findTokenByHashForUpdate: async () => ({ ...validToken, consumed_at: new Date().toISOString() }),
  }, 'TRANSFER_CODE_USED', 409);
});

test('claim: code expired', async (t) => {
  await claimRejects(t, {
    findTokenByHashForUpdate: async () => ({ ...validToken, expires_at: new Date(Date.now() - 1).toISOString() }),
  }, 'TRANSFER_CODE_EXPIRED', 410);
});

test('claim: a web identity cannot claim (must be the app)', async (t) => {
  await claimRejects(t, {
    findTokenByHashForUpdate: async () => validToken,
    lockUsers: users(webUser, { ...appUser, origin: 'web' }),
  }, 'APP_REQUIRED', 403);
});

test('claim: banned web identity cannot be transferred', async (t) => {
  await claimRejects(t, {
    findTokenByHashForUpdate: async () => validToken,
    lockUsers: users({ ...webUser, is_banned: true }, appUser),
  }, 'ACCOUNT_BANNED', 403);
});

test('claim: already merged web identity', async (t) => {
  await claimRejects(t, {
    findTokenByHashForUpdate: async () => validToken,
    lockUsers: users({ ...webUser, merged_into_user_id: 'someone' }, appUser),
  }, 'TRANSFER_CODE_USED', 409);
});

test('claim: success merges web into app and consumes the code', async (t) => {
  const calls = [];
  stub(t, {
    findTokenByHashForUpdate: async () => validToken,
    lockUsers: users(webUser, appUser),
    mergeIdentities: async (_c, webId, appId) => {
      calls.push(['merge', webId, appId]);
      return { moved: ['c1'], mergedInto: ['c2', 'c1'], skipped: ['c3'] };
    },
    consumeToken: async (_c, tokenId, consumer) => { calls.push(['consume', tokenId, consumer]); },
  });

  const res = await service.claimTransferCode('app-1', 'abcd-2345');
  assert.deepEqual(calls, [['merge', 'web-1', 'app-1'], ['consume', 'tok-1', 'app-1']]);
  assert.deepEqual(res.conversationIds.sort(), ['c1', 'c2']);
  assert.deepEqual(res.skippedConversationIds, ['c3']);
});
