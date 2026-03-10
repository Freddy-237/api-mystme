const pool = require('../config/database');
const logger = require('./logger');

const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
const RETENTION_MS = 24 * 60 * 60 * 1000;

let lastCleanupAt = 0;
let cleanupPromise = null;

const getBucketStartMs = (windowMs, now = Date.now()) => {
  return Math.floor(now / windowMs) * windowMs;
};

const maybeCleanup = async () => {
  const now = Date.now();
  if (cleanupPromise || now - lastCleanupAt < CLEANUP_INTERVAL_MS) return;

  lastCleanupAt = now;
  cleanupPromise = pool
    .query(
      'DELETE FROM distributed_rate_limits WHERE bucket_start < NOW() - ($1 * INTERVAL \'1 millisecond\')',
      [RETENTION_MS],
    )
    .catch((error) => {
      logger.warn({ err: error }, 'distributed rate-limit cleanup failed');
    })
    .finally(() => {
      cleanupPromise = null;
    });

  await cleanupPromise;
};

const consume = async ({ scope, key, windowMs, max, increment = 1 }) => {
  if (!scope) throw new Error('rate limit scope is required');
  if (!key) throw new Error('rate limit key is required');

  const bucketStartMs = getBucketStartMs(windowMs);
  const result = await pool.query(
    `INSERT INTO distributed_rate_limits (scope, identifier, bucket_start, hits, updated_at)
     VALUES ($1, $2, to_timestamp($3 / 1000.0), $4, NOW())
     ON CONFLICT (scope, identifier, bucket_start)
     DO UPDATE SET hits = distributed_rate_limits.hits + EXCLUDED.hits,
                   updated_at = NOW()
     RETURNING hits`,
    [scope, key, bucketStartMs, increment],
  );

  void maybeCleanup();

  const hits = Number(result.rows[0]?.hits || 0);
  return {
    allowed: hits <= max,
    hits,
    remaining: Math.max(0, max - hits),
    resetAt: new Date(bucketStartMs + windowMs),
  };
};

module.exports = {
  consume,
  getBucketStartMs,
};