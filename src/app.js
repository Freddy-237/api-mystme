const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { randomUUID } = require('crypto');
const env = require('./config/env');
const pool = require('./config/database');

// Import routes
const identityRoutes = require('./modules/identity/identity.routes');
const linkRoutes = require('./modules/link/link.routes');
const conversationRoutes = require('./modules/conversation/conversation.routes');
const messageRoutes = require('./modules/message/message.routes');
const trustRoutes = require('./modules/trust/trust.routes');
const moderationRoutes = require('./modules/moderation/moderation.routes');

// Import middlewares
const errorMiddleware = require('./middlewares/error.middleware');
const csrfMiddleware = require('./middlewares/csrf.middleware');

const app = express();

app.set('trust proxy', 1);

// --- Security headers ---
app.use(helmet());

// --- Global middlewares ---
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (env.corsOrigins.length === 0) {
        if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
          return callback(null, true);
        }
        return callback(new Error('CORS origin denied'));
      }
      if (env.corsOrigins.includes(origin)) return callback(null, true);
      return callback(new Error('CORS origin denied'));
    },
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id'],
    maxAge: 86400,
  })
);
app.use(express.json({ limit: '1mb' }));
app.use(csrfMiddleware);

app.use((req, res, next) => {
  const requestId = req.headers['x-request-id'] || randomUUID();
  req.requestId = requestId;
  res.setHeader('x-request-id', requestId);
  next();
});

// --- Rate limiting (express-rate-limit) ---
app.use('/identity/init', rateLimit({ windowMs: 60_000, max: 10, standardHeaders: true, legacyHeaders: false }));
app.use('/message',       rateLimit({ windowMs: 60_000, max: 30, standardHeaders: true, legacyHeaders: false }));
app.use('/conversation',  rateLimit({ windowMs: 60_000, max: 40, standardHeaders: true, legacyHeaders: false }));

// --- Health check ---
app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'up', timestamp: new Date().toISOString() });
  } catch {
    res.status(503).json({ status: 'degraded', db: 'down', timestamp: new Date().toISOString() });
  }
});

// --- API routes ---
app.use('/identity', identityRoutes);
app.use('/link', linkRoutes);
app.use('/conversation', conversationRoutes);
app.use('/message', messageRoutes);
app.use('/trust', trustRoutes);
app.use('/moderation', moderationRoutes);

// --- 404 ---
app.use((_req, res) => {
  res.status(404).json({ message: 'Route introuvable' });
});

// --- Error handler ---
app.use(errorMiddleware);

module.exports = app;
