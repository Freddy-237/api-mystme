/**
 * Sentry error-monitoring initialisation.
 *
 * Activated only when `SENTRY_DSN` env var is set.
 * Safe to import even when the DSN is absent — all helpers become no-ops.
 */
const Sentry = require('@sentry/node');
const logger = require('../utils/logger');

const dsn = process.env.SENTRY_DSN || '';

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || 'development',
    release: process.env.npm_package_version || '0.0.0',
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.2 : 1.0,
    // Scrub sensitive headers
    beforeSend(event) {
      if (event.request && event.request.headers) {
        delete event.request.headers.cookie;
        delete event.request.headers.authorization;
      }
      return event;
    },
  });
  logger.info('Sentry initialised');
} else {
  logger.info('SENTRY_DSN not set — Sentry disabled');
}

module.exports = Sentry;
