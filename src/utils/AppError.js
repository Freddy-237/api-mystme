/**
 * Custom application error with HTTP status code.
 * Replaces `Object.assign(new Error('msg'), { statusCode })` pattern.
 */
class AppError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
  }
}

module.exports = AppError;
