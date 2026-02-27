require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const fs = require('fs');
const path = require('path');
const pool = require('../config/database');
const logger = require('../utils/logger');

const runMigration = async () => {
  const migrationPath = path.join(__dirname, 'migrations', '001_init.sql');
  const sql = fs.readFileSync(migrationPath, 'utf-8');

  try {
    await pool.query(sql);
    logger.info('✅ Migration exécutée avec succès');
  } catch (err) {
    logger.error('❌ Erreur lors de la migration:', err.message);
  } finally {
    await pool.end();
  }
};

runMigration();
