// Unit tests for the web-identity model (no database: repositories stubbed).
const test = require('node:test');
const assert = require('node:assert/strict');

const identityRepository = require('../src/modules/identity/identity.repository');
const conversationRepository = require('../src/modules/conversation/conversation.repository');
const messageRepository = require('../src/modules/message/message.repository');
const linkRepository = require('../src/modules/link/link.repository');
const identityService = require('../src/modules/identity/identity.service');
const messageService = require('../src/modules/message/message.service');
const linkService = require('../src/modules/link/link.service');
const webTrial = require('../src/config/webTrial');

const DAY = 24 * 60 * 60 * 1000;

const stub = (t, target, overrides) => {
  for (const [name, impl] of Object.entries(overrides)) {
    const original = target[name];
    target[name] = impl;
    t.after(() => { target[name] = original; });
  }
};

const conv = { id: 'conv-1', owner_id: 'owner', anonymous_id: 'anon', status: 'active' };

const stubWriter = (t, sender, sentCount = 0) => {
  stub(t, conversationRepository, { findById: async () => conv });
  stub(t, identityRepository, { findAccessStateById: async () => sender });
  stub(t, messageRepository, { countBySenderInConversation: async () => sentCount });
};

// ── Identity creation ─────────────────────────────────────────────────────
test('web identity gets a 7-day window; app identity none', async (t) => {
  const created = [];
  stub(t, identityRepository, {
    createUser: async (u) => { created.push(u); return { ...u, created_at: new Date() }; },
  });

  const web = await identityService.initIdentity({ origin: 'web' });
  const app = await identityService.initIdentity({ origin: 'anything-else' });

  assert.equal(created[0].origin, 'web');
  const windowMs = new Date(created[0].web_expires_at).getTime() - Date.now();
  assert.ok(Math.abs(windowMs - 7 * DAY) < 5_000, 'expires ~7 days from now');
  assert.equal(web.user.web_locked, false);
  assert.ok(web.user.web_purge_at instanceof Date);

  assert.equal(created[1].origin, 'app');
  assert.equal(created[1].web_expires_at, null);
  assert.equal(app.user.web_locked, false);
  assert.equal(app.user.web_purge_at, null);
});

test('locked web identity: purge date = expiry + 30 days', () => {
  const expires = new Date(Date.now() - DAY);
  const user = identityService.toPublicUser({ id: 'u', origin: 'web', web_expires_at: expires });
  assert.equal(user.web_locked, true);
  assert.equal(user.web_purge_at.getTime(), expires.getTime() + 30 * DAY);
});

// ── Write rules ───────────────────────────────────────────────────────────
test('app users can write in old conversations (no conversation expiry)', async (t) => {
  stubWriter(t, { origin: 'app', web_expires_at: null }, 999);
  stub(t, conversationRepository, {
    findById: async () => ({ ...conv, started_at: new Date(Date.now() - 365 * DAY) }),
  });
  await messageService.assertConversationWritable('conv-1', 'anon');
});

test('web user within 7 days and under the limit can write', async (t) => {
  stubWriter(t, { origin: 'web', web_expires_at: new Date(Date.now() + DAY) }, 0);
  await messageService.assertConversationWritable('conv-1', 'anon');
});

test('web user after 7 days is read-only (WEB_TRIAL_EXPIRED)', async (t) => {
  stubWriter(t, { origin: 'web', web_expires_at: new Date(Date.now() - 1000) }, 0);
  await assert.rejects(
    messageService.assertConversationWritable('conv-1', 'anon'),
    (err) => err.statusCode === 403 && err.code === 'WEB_TRIAL_EXPIRED',
  );
});

test('web message limit is enforced server-side (WEB_MESSAGE_LIMIT)', async (t) => {
  stubWriter(t, { origin: 'web', web_expires_at: new Date(Date.now() + DAY) }, webTrial.WEB_MESSAGE_LIMIT);
  await assert.rejects(
    messageService.assertConversationWritable('conv-1', 'anon'),
    (err) => err.statusCode === 403 && err.code === 'WEB_MESSAGE_LIMIT',
  );
});

test('blocked conversation exposes CONVERSATION_BLOCKED', async (t) => {
  stubWriter(t, { origin: 'app' });
  stub(t, conversationRepository, { findById: async () => ({ ...conv, status: 'blocked' }) });
  await assert.rejects(
    messageService.assertConversationWritable('conv-1', 'anon'),
    (err) => err.code === 'CONVERSATION_BLOCKED',
  );
});

// ── Links ─────────────────────────────────────────────────────────────────
test('creating a link twice returns the same active link', async (t) => {
  const active = { id: 'link-1', code: 'abcd1234', owner_id: 'owner', is_active: true };
  let inserts = 0;
  stub(t, identityRepository, { findAccessStateById: async () => ({ origin: 'app' }) });
  stub(t, linkRepository, {
    findActiveByOwner: async () => active,
    createLink: async () => { inserts += 1; return active; },
  });

  const first = await linkService.createLink('owner');
  const second = await linkService.createLink('owner');
  assert.equal(first.link.id, 'link-1');
  assert.equal(second.link.id, 'link-1');
  assert.equal(first.created, false);
  assert.equal(inserts, 0);
});

test('concurrent link creation falls back to the winner on unique violation', async (t) => {
  const winner = { id: 'link-w', code: 'wwww0000', owner_id: 'owner', is_active: true };
  let lookups = 0;
  stub(t, identityRepository, { findAccessStateById: async () => ({ origin: 'app' }) });
  stub(t, linkRepository, {
    findActiveByOwner: async () => (lookups++ === 0 ? undefined : winner),
    createLink: async () => { const e = new Error('dup'); e.code = '23505'; throw e; },
  });

  const { link, created } = await linkService.createLink('owner');
  assert.equal(link.id, 'link-w');
  assert.equal(created, false);
});

test('web identities cannot create links (APP_REQUIRED)', async (t) => {
  stub(t, identityRepository, { findAccessStateById: async () => ({ origin: 'web' }) });
  await assert.rejects(
    linkService.createLink('web-user'),
    (err) => err.statusCode === 403 && err.code === 'APP_REQUIRED',
  );
});

test('public invite lookup never exposes the owner id', async (t) => {
  stub(t, linkRepository, {
    findPublicByCode: async () => ({ code: 'abcd1234', is_active: true, owner_pseudo: 'Fox' }),
  });
  const link = await linkService.getLinkByCode('abcd1234');
  assert.equal(link.owner_id, undefined);
  assert.equal(link.owner_pseudo, 'Fox');
});
