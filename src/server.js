require('dotenv').config();
const http = require('http');
const app = require('./app');
const { initSocket } = require('./config/socket');
const pool = require('./config/database');
const logger = require('./utils/logger');
const env = require('./config/env');

const server = http.createServer(app);

// Init Socket.io
initSocket(server);

// Test DB connection then start
pool.query('SELECT NOW()')
  .then(() => {
    logger.info('✅ Connected to PostgreSQL');
    server.listen(env.port, () => {
      logger.info(`🚀 Server running on port ${env.port}`);
    });
  })
  .catch((err) => {
    logger.error('❌ Failed to connect to PostgreSQL', err.message);
    process.exit(1);
  });

const shutdown = async (signal) => {
  logger.info({ signal }, 'Received shutdown signal');
  server.close(async () => {
    try {
      await pool.end();
      logger.info('PostgreSQL pool closed');
      process.exit(0);
    } catch (error) {
      logger.error({ err: error }, 'Error during shutdown');
      process.exit(1);
    }
  });
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
