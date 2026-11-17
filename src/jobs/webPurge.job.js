/**
 * Purge of expired web (PWA) identities.
 *
 * A web identity can write for WEB_TRIAL_DAYS, is then read-only for
 * WEB_LOCK_DAYS, and after that it is erased here together with its
 * conversations, messages and media — exactly like an account deletion.
 * App identities are never purged.
 */
const withTransaction = require('../utils/withTransaction');
const logger = require('../utils/logger');
const identityRepository = require('../modules/identity/identity.repository');
const { deleteMedia } = require('../services/upload.service');
const { WEB_LOCK_DAYS } = require('../config/webTrial');

const RUN_EVERY_MS = 6 * 60 * 60 * 1000;
const FIRST_RUN_DELAY_MS = 2 * 60 * 1000;
const BATCH_SIZE = 200;

/** Erase one batch. Returns how many identities were removed. */
const runOnce = async ({ batchSize = BATCH_SIZE } = {}) => {
  const ids = await identityRepository.findPurgeableWebIdentityIds(WEB_LOCK_DAYS, batchSize);
  let purged = 0;

  for (const id of ids) {
    try {
      // One transaction per identity: a failure never blocks the others.
      const result = await withTransaction((client) =>
        identityRepository.deleteAccountData(client, id, { webOnly: true }));
      if (!result) continue;
      purged += 1;
      await deleteMedia(result.media);
    } catch (error) {
      logger.error({ err: error, userId: id }, 'web purge: identity skipped');
    }
  }

  if (purged > 0) logger.info({ purged }, 'web purge: expired web identities erased');
  return purged;
};

let timer = null;

const start = () => {
  if (timer || process.env.NODE_ENV === 'test') return;
  const tick = () => {
    runOnce().catch((error) => logger.error({ err: error }, 'web purge failed'));
  };
  setTimeout(tick, FIRST_RUN_DELAY_MS).unref();
  timer = setInterval(tick, RUN_EVERY_MS);
  timer.unref();
};

const stop = () => {
  if (timer) clearInterval(timer);
  timer = null;
};

module.exports = { runOnce, start, stop };
