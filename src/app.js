const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { randomUUID, createHash } = require('crypto');
const parseCookies = require('./utils/parseCookies');
const { extractBearerToken } = require('./utils/authToken');
const Sentry = require('./config/sentry');
const AppError = require('./utils/AppError');
const env = require('./config/env');
const pool = require('./config/database');

// Import routes
const identityRoutes = require('./modules/identity/identity.routes');
const linkRoutes = require('./modules/link/link.routes');
const conversationRoutes = require('./modules/conversation/conversation.routes');
const messageRoutes = require('./modules/message/message.routes');
const trustRoutes = require('./modules/trust/trust.routes');
const moderationRoutes = require('./modules/moderation/moderation.routes');
const subscriptionRoutes = require('./modules/subscription/subscription.routes');
const adminRoutes = require('./modules/admin/admin.routes');

// Import middlewares
const errorMiddleware = require('./middlewares/error.middleware');
const csrfMiddleware = require('./middlewares/csrf.middleware');
const createRateLimit = require('./middlewares/rateLimit.middleware');
const { getDefaultKey } = createRateLimit;

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1);

// --- Security headers ---
app.use(
  helmet({
    contentSecurityPolicy: false, // Let the PWA/Vercel handle CSP
    crossOriginEmbedderPolicy: false, // Required for cross-origin media (Cloudinary)
    hsts: { maxAge: 63_072_000, includeSubDomains: true, preload: true },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  }),
);

// --- Request tracing ---
app.use((req, res, next) => {
  const requestId = req.headers['x-request-id'] || randomUUID();
  req.requestId = requestId;
  res.setHeader('x-request-id', requestId);
  next();
});

// --- Global middlewares ---
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
        return callback(null, true);
      }
      if (env.corsOrigins.length === 0) {
        return callback(new AppError('CORS origin denied', 403));
      }
      if (env.corsOrigins.includes(origin)) return callback(null, true);
      return callback(new AppError('CORS origin denied', 403));
    },
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token', 'X-Request-Id', 'X-Admin-Request'],
    exposedHeaders: ['X-Request-Id'],
    maxAge: 86400,
  })
);
app.use(express.json({ limit: '1mb' }));
app.use(csrfMiddleware);

// --- Rate limiting (express-rate-limit) ---
if (process.env.NODE_ENV !== 'test') {
  // Safety net for every route without a tighter limit of its own. Keyed by
  // session when there is one: mobile carriers put many users behind one IP
  // (CGNAT), so an IP-only cap would throttle innocent users together.
  const sessionOrIpKey = (req) => {
    const token = extractBearerToken(req.headers.authorization)
      || parseCookies(req.headers.cookie)[env.authCookieName];
    return token
      ? `s:${createHash('sha256').update(token).digest('hex').slice(0, 32)}`
      : `ip:${getDefaultKey(req)}`;
  };
  app.use(createRateLimit('http:global', { windowMs: 60_000, maxRequests: 300, keyGenerator: sessionOrIpKey }));
  app.use('/identity/init', createRateLimit('http:identity:init', { windowMs: 60_000, maxRequests: 10 }));
  app.use('/message', createRateLimit('http:message', { windowMs: 60_000, maxRequests: 30 }));
  app.use('/conversation', createRateLimit('http:conversation', { windowMs: 60_000, maxRequests: 40 }));
}

// --- Health check ---
app.get('/health', async (_req, res) => {
  const report = {
    status: 'ok',
    db: 'unknown',
    cloudinary: env.cloudinaryConfigured ? 'configured' : 'MISSING',
    email: {
      provider: env.emailProvider,
      smtp: env.hasSmtpConfig() ? 'configured' : 'MISSING',
      brevo: env.hasBrevoApiConfig() ? 'configured' : 'MISSING',
    },
    timestamp: new Date().toISOString(),
  };

  try {
    await pool.query('SELECT 1');
    report.db = 'up';
  } catch (error) {
    report.status = 'degraded';
    report.db = 'down';
    report.error = 'Database unreachable';
    return res.status(503).json(report);
  }

  if (!env.cloudinaryConfigured) {
    report.cloudinary = 'disabled';
    return res.json(report);
  }

  return res.json(report);
});

// --- Root route for health check ---
app.get('/', (_req, res) => res.send('OK'));

// --- API routes ---
app.use('/identity', identityRoutes);
app.use('/link', linkRoutes);
app.use('/conversation', conversationRoutes);
app.use('/message', messageRoutes);
app.use('/trust', trustRoutes);
app.use('/moderation', moderationRoutes);
app.use('/subscription', subscriptionRoutes);
app.use('/admin', adminRoutes);

// --- 404 ---
app.use((_req, res) => {
  res.status(404).json({ message: 'Route introuvable' });
});

// --- Error handler ---
app.use(errorMiddleware);

module.exports = app;
