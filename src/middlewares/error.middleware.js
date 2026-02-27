const logger = require('../utils/logger');

const errorMiddleware = (err, req, res, _next) => {
  logger.error({ err, method: req.method, url: req.originalUrl }, err.message);

  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal server error';

  res.status(statusCode).json({
    error: true,
    message,
  });
};

module.exports = errorMiddleware;
