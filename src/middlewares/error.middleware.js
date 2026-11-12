const logger = require('../utils/logger');
const Sentry = require('../config/sentry');

const errorMiddleware = (err, req, res, _next) => {
  if (err?.name === 'MulterError' && err?.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      error: true,
      message: 'Fichier trop volumineux (max 20MB)',
      requestId: req.requestId,
    });
  }

  logger.error(
    {
      err,
      requestId: req.requestId,
      method: req.method,
      url: req.originalUrl,
    },
    err.message,
  );

  // Report 5xx errors to Sentry
  const statusCode = err.statusCode || 500;
  if (statusCode >= 500) {
    Sentry.captureException(err, {
      extra: { requestId: req.requestId, method: req.method, url: req.originalUrl },
    });
  }

  const message = statusCode >= 500
    ? 'Le service est temporairement indisponible. Réessaie plus tard.'
    : (typeof err.message === 'string' && err.message.trim()
      ? err.message
      : 'Une erreur est survenue.');

  res.status(statusCode).json({
    error: true,
    message,
    requestId: req.requestId,
  });
};

module.exports = errorMiddleware;
