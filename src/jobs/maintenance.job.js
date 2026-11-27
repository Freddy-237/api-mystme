/**
 * Daily maintenance:
 *   - encrypted database backup (see services/backup.service);
 *   - files of deleted messages: removed from Cloudinary once no pending
 *     report needs them as evidence;
 *   - retention: handled reports whose conversation no longer exists are kept
 *     REPORT_RETENTION_DAYS after their review, then erased; expired email
 *     codes and transfer codes are erased after a day.
 */
const pool = require('../config/database');
const logger = require('../utils/logger');
const backupService = require('../services/backup.service');
const { deleteMedia } = require('../services/upload.service');

const RUN_EVERY_MS = 24 * 60 * 60 * 1000;
const FIRST_RUN_DELAY_MS = 10 * 60 * 1000;
const REPORT_RETENTION_DAYS = 180;
const MEDIA_BATCH = 200;

const cleanDeletedMessageMedia = async () => {
  const { rows } = await pool.query(
    `SELECT m.id, m.media_url, m.media_type
       FROM messages m
      WHERE m.is_deleted AND m.media_url IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM reports r WHERE r.message_id = m.id AND r.status = 'pending')
      LIMIT $1`,
    [MEDIA_BATCH],
  );
  if (!rows.length) return 0;
  await deleteMedia(rows);
  await pool.query('UPDATE messages SET media_url = NULL WHERE id = ANY($1::uuid[])', [rows.map((r) => r.id)]);
  return rows.length;
};

const applyRetention = async () => {
  const reports = await pool.query(
    `DELETE FROM reports
      WHERE status <> 'pending' AND conversation_id IS NULL
        AND reviewed_at < NOW() - ($1::int * INTERVAL '1 day')`,
    [REPORT_RETENTION_DAYS],
  );
  const otps = await pool.query(
    "DELETE FROM identity_email_otps WHERE expires_at < NOW() - INTERVAL '1 day'",
  );
  const transfers = await pool.query(
    "DELETE FROM identity_transfer_tokens WHERE expires_at < NOW() - INTERVAL '1 day'",
  );
  return { reports: reports.rowCount, otps: otps.rowCount, transfers: transfers.rowCount };
};

/** One full pass. Each step is independent: a failure never skips the others. */
const runOnce = async () => {
  const outcome = {};
  if (backupService.isConfigured()) {
    try {
      outcome.backup = await backupService.runBackup();
    } catch (error) {
      outcome.backup = { error: error.message };
      logger.error({ err: error }, 'maintenance: database backup FAILED');
    }
  } else {
    outcome.backup = { skipped: true };
    logger.warn('maintenance: BACKUP_ENCRYPTION_KEY not set — database NOT backed up');
  }
  try {
    outcome.mediaCleaned = await cleanDeletedMessageMedia();
  } catch (error) {
    logger.error({ err: error }, 'maintenance: media cleanup failed');
  }
  try {
    outcome.retention = await applyRetention();
  } catch (error) {
    logger.error({ err: error }, 'maintenance: retention failed');
  }
  logger.info({ mediaCleaned: outcome.mediaCleaned, retention: outcome.retention }, 'maintenance done');
  return outcome;
};

let timer = null;

const start = () => {
  if (timer || process.env.NODE_ENV === 'test') return;
  const tick = () => {
    runOnce().catch((error) => logger.error({ err: error }, 'maintenance failed'));
  };
  setTimeout(tick, FIRST_RUN_DELAY_MS).unref();
  timer = setInterval(tick, RUN_EVERY_MS);
  timer.unref();
};

const stop = () => {
  if (timer) clearInterval(timer);
  timer = null;
};

module.exports = { runOnce, start, stop, cleanDeletedMessageMedia, applyRetention, REPORT_RETENTION_DAYS };
