/**
 * Custom application error with HTTP status code and optional
 * machine-readable `code` (e.g. 'WEB_TRIAL_EXPIRED') that clients can
 * branch on without parsing human messages.
 */
class AppError extends Error {
  constructor(message, statusCode = 500, code = null) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

module.exports = AppError;
