const { Pool } = require('pg');
const env = require('./env');

const baseConfig = env.databaseUrl
  ? {
      connectionString: env.databaseUrl,
    }
  : {
      host: env.db.host,
      port: env.db.port,
      user: env.db.user,
      password: env.db.password,
      database: env.db.name,
    };

const sslConfig = env.dbSsl
  ? {
      rejectUnauthorized: env.dbSslRejectUnauthorized,
    }
  : false;

const pool = new Pool({
  ...baseConfig,
  ssl: sslConfig,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

module.exports = pool;
