require('dotenv').config();

const parseOrigins = () => {
  const raw = process.env.CORS_ORIGINS || '';
  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
};

const parseBool = (value, fallback = false) => {
  if (value == null) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
};

const requireInProduction = (name, value) => {
  if (process.env.NODE_ENV === 'production' && !value) {
    throw new Error(`${name} is required in production`);
  }
  return value;
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
  dbSsl: parseBool(process.env.DB_SSL, process.env.NODE_ENV === 'production'),
  databaseUrl: process.env.DATABASE_URL || undefined,
  // When DATABASE_URL is provided (e.g. Railway), individual DB_* vars are not
  // required — the connection string already contains host, user, db name, etc.
  db: {
    host: process.env.DATABASE_URL
      ? (process.env.DB_HOST || 'localhost')
      : (requireInProduction('DB_HOST', process.env.DB_HOST) || 'localhost'),
    port: parseInt(process.env.DB_PORT) || 5432,
    user: process.env.DATABASE_URL
      ? (process.env.DB_USER || 'postgres')
      : (requireInProduction('DB_USER', process.env.DB_USER) || 'postgres'),
    password: process.env.DB_PASSWORD || '',
    name: process.env.DATABASE_URL
      ? (process.env.DB_NAME || 'mystme')
      : (requireInProduction('DB_NAME', process.env.DB_NAME) || 'mystme'),
  },
  smtpHost: process.env.SMTP_HOST || '',
  smtpPort: parseInt(process.env.SMTP_PORT || '587', 10),
  smtpSecure: parseBool(process.env.SMTP_SECURE, false),
  smtpUser: process.env.SMTP_USER || '',
  smtpPass: process.env.SMTP_PASS || '',
  mailFrom: process.env.MAIL_FROM || '',
  brevoApiKey: process.env.BREVO_API_KEY || '',
  brevoSenderEmail: process.env.BREVO_SENDER_EMAIL || '',
  brevoSenderName: process.env.BREVO_SENDER_NAME || '',
};
