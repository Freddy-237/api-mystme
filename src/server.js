require('dotenv').config();
const http = require('http');
const app = require('./app');
const { initSocket } = require('./config/socket');
const pool = require('./config/database');
const logger = require('./utils/logger');
const env = require('./config/env');
const runMigration = require('./database/runMigration');
const webPurgeJob = require('./jobs/webPurge.job');

const server = http.createServer(app);

// Init Socket.io
initSocket(server);

process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'Unhandled promise rejection, shutting down');
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  logger.error({ err: error }, 'Uncaught exception, shutting down');
  process.exit(1);
});

// Run migrations → test DB → start
runMigration({ closePool: false })
  .then(() => pool.query('SELECT NOW()'))
  .then(() => {
    logger.info('Connected to PostgreSQL');
    server.listen(env.port, () => {
      logger.info(`Server running on port ${env.port}`);
      webPurgeJob.start();
    });
  })
  .catch((err) => {
    logger.error({ err }, 'Failed to start server');
    process.exit(1);
  });

const shutdown = async (signal) => {
  logger.info({ signal }, 'Received shutdown signal');
  webPurgeJob.stop();
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
