const logger = require('../utils/logger');
const env = require('../config/env');

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

  const statusCode = err.statusCode || 500;
  const message = statusCode >= 500 && env.isProduction
    ? 'Internal server error'
    : (err.message || 'Internal server error');

  res.status(statusCode).json({
    error: true,
    message,
    requestId: req.requestId,
  });
};

module.exports = errorMiddleware;
