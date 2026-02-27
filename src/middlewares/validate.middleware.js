const { validationResult } = require('express-validator');

/**
 * Middleware that checks express-validator results.
 * Place it AFTER the validation chain in the route definition.
 */
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: true,
      message: errors.array().map(e => e.msg).join(', '),
      details: errors.array(),
    });
  }
  next();
};

module.exports = validate;
