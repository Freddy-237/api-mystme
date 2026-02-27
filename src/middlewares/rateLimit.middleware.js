/**
 * Simple in-memory rate limiter.
 * Replace with redis-based solution in production.
 */
const rateLimit = (windowMs = 60000, maxRequests = 60) => {
  const requests = new Map();

  // Prune stale IPs every 5 minutes to prevent memory leak.
  setInterval(() => {
    const now = Date.now();
    for (const [ip, timestamps] of requests) {
      const valid = timestamps.filter(t => now - t < windowMs);
      if (valid.length === 0) requests.delete(ip);
      else requests.set(ip, valid);
    }
  }, 5 * 60 * 1000).unref();

  return (req, res, next) => {
    const ip = req.ip || req.connection.remoteAddress;
    const now = Date.now();

    if (!requests.has(ip)) {
      requests.set(ip, []);
    }

    const timestamps = requests.get(ip).filter(t => now - t < windowMs);
    timestamps.push(now);
    requests.set(ip, timestamps);

    if (timestamps.length > maxRequests) {
      return res.status(429).json({ message: 'Trop de requêtes, réessaye plus tard' });
    }

    next();
  };
};

module.exports = rateLimit;
