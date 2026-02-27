require('dotenv').config();

const parseOrigins = () => {
  const raw = process.env.CORS_ORIGINS || '';
  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
};

module.exports = {
  port: process.env.PORT || 5000,
  isProduction: process.env.NODE_ENV === 'production',
  jwtSecret: (() => {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('JWT_SECRET is required in production');
      }
      console.warn('⚠️  WARNING: JWT_SECRET is not set! Using insecure default for local dev only.');
      return 'default_secret';
    }
    return secret;
  })(),
  corsOrigins: parseOrigins(),
  authCookieName: process.env.AUTH_COOKIE_NAME || 'mystme_token',
  authCookieDomain: process.env.AUTH_COOKIE_DOMAIN || undefined,
  csrfCookieName: process.env.CSRF_COOKIE_NAME || 'mystme_csrf',
  csrfHeaderName: process.env.CSRF_HEADER_NAME || 'x-csrf-token',
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT) || 5432,
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    name: process.env.DB_NAME || 'mystme',
  },
};
