require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const fs = require('fs');
const path = require('path');
const pool = require('../config/database');
const logger = require('../utils/logger');

/**
 * Apply all pending SQL migrations.
 * Safe to call multiple times — uses schema_migrations tracking table.
 *
 * @param {object} [options]
 * @param {boolean} [options.closePool=true] — set false when called from server.js
 */
const runMigration = async ({ closePool = true } = {}) => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    const migrationDir = path.join(__dirname, 'migrations');
    const files = fs
      .readdirSync(migrationDir)
      .filter((name) => name.endsWith('.sql'))
      .sort();

    const appliedResult = await pool.query('SELECT filename FROM schema_migrations');
    const applied = new Set(appliedResult.rows.map((row) => row.filename));

    const usersExists = await pool.query(`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'users'
      ) AS exists;
    `);

    if (usersExists.rows[0]?.exists && !applied.has('001_init.sql')) {
      await pool.query(
        `INSERT INTO schema_migrations (filename)
         VALUES ($1)
         ON CONFLICT (filename) DO NOTHING`,
        ['001_init.sql']
      );
      applied.add('001_init.sql');
      logger.info('ℹ️ Base existante détectée: 001_init.sql marqué comme déjà appliqué');
    }

    for (const filename of files) {
      if (applied.has(filename)) {
        logger.info({ migration: filename }, '↪️ Migration déjà appliquée, ignorée');
        continue;
      }

      const sql = fs.readFileSync(path.join(migrationDir, filename), 'utf-8');
      await pool.query('BEGIN');
      try {
        await pool.query(sql);
        await pool.query(
          'INSERT INTO schema_migrations (filename) VALUES ($1)',
          [filename]
        );
        await pool.query('COMMIT');
        logger.info({ migration: filename }, '✅ Migration appliquée');
      } catch (error) {
        await pool.query('ROLLBACK');
        throw error;
      }
    }

    logger.info('✅ Migrations terminées avec succès');
  } catch (err) {
    logger.error('❌ Erreur lors de la migration:', err.message);
    process.exitCode = 1;
  } finally {
    if (closePool) await pool.end();
  }
};

// Allow direct invocation: node src/database/runMigration.js
if (require.main === module) {
  runMigration();
}

module.exports = runMigration;
