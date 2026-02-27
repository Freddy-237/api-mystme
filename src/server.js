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
